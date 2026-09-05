/**
 * YouTube & YouTube Music OBS Broadcaster - Background Service Worker
 * Single Canonical Channel: 'yt-overlay' (Zero-config, works with both YouTube & YouTube Music)
 */

class NativeMQTTClient {
  constructor(brokers, channelId = 'yt-overlay') {
    this.brokers = brokers;
    this.brokerIdx = 0;
    this.channelId = channelId;
    this.ws = null;
    this.connected = false;
    this.queue = [];
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.connect();
  }

  connect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }

    const brokerUrl = this.brokers[this.brokerIdx];
    try {
      this.ws = new WebSocket(brokerUrl, ['mqtt']);
      this.ws.binaryType = 'arraybuffer';
    } catch (e) {
      console.warn('[YT-OBS Service Worker] WebSocket error:', e);
      this.retry();
      return;
    }

    this.ws.onopen = () => {
      this.sendConnect();
    };

    this.ws.onmessage = (evt) => {
      const data = new Uint8Array(evt.data);
      const packetType = data[0] >> 4;
      if (packetType === 2) { // CONNACK
        this.connected = true;
        console.log('[YT-OBS Service Worker] Connected to MQTT broker:', brokerUrl);
        
        // Immediately flush any queued tracks that arrived before connection was ready
        this.flushQueue();

        // Subscribe to theme updates from setup.html
        this.sendSubscribe([`yt/overlay/${this.channelId}/theme`, `ytm/overlay/${this.channelId}/theme`]);

        // Heartbeat ping every 25 seconds
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ
          }
        }, 25000);
      } else if (packetType === 3) { // PUBLISH
        let offset = 1;
        let multiplier = 1;
        let digit;
        do {
          digit = data[offset++];
          multiplier *= 128;
        } while ((digit & 128) !== 0 && offset < data.length);

        const topicLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        const topic = new TextDecoder().decode(data.subarray(offset, offset + topicLen));
        offset += topicLen;
        const payloadStr = new TextDecoder().decode(data.subarray(offset));
        try {
          if (topic.endsWith('/theme')) {
            const parsed = JSON.parse(payloadStr);
            if (parsed.theme || parsed.accent) {
              const updates = {};
              if (parsed.theme) updates.theme = parsed.theme;
              if (parsed.accent) updates.accent = parsed.accent;
              if (lastTrack) {
                if (parsed.theme) lastTrack.theme = parsed.theme;
                if (parsed.accent) lastTrack.accent = parsed.accent;
              }
              chrome.storage.sync.set(updates);
              chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://youtube.com/*", "*://music.youtube.com/*"] }, (tabs) => {
                if (tabs) {
                  tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, Object.assign({ action: 'force_update' }, updates), () => {
                      if (chrome.runtime.lastError) {}
                    });
                  });
                }
              });
            }
          }
        } catch (e) {}
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this.pingTimer);
      this.retry();
    };

    this.ws.onerror = () => {
      this.connected = false;
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
      }
    };
  }

  retry() {
    this.brokerIdx = (this.brokerIdx + 1) % this.brokers.length;
    this.reconnectTimer = setTimeout(() => this.connect(), 2000);
  }

  sendConnect() {
    const clientId = 'yt_worker_' + Math.random().toString(16).substring(2, 8);
    const protocol = [0x00, 0x04, 0x4d, 0x51, 0x54, 0x54]; // "MQTT" (3.1.1)
    const version = 0x04;
    const flags = 0x02; // Clean Session
    const keepAlive = [0x00, 0x3c]; // 60s

    const clientIdBytes = new TextEncoder().encode(clientId);
    const idLen = [clientIdBytes.length >> 8, clientIdBytes.length & 0xff];
    const payload = [...protocol, version, flags, ...keepAlive, ...idLen, ...clientIdBytes];

    let x = payload.length;
    const encodedLen = [];
    do {
      let digit = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) digit = digit | 0x80;
      encodedLen.push(digit);
    } while (x > 0);

    const packet = new Uint8Array([0x10, ...encodedLen, ...payload]);
    this.ws.send(packet);
  }

  sendSubscribe(topics) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packetId = [0x00, 0x01];
    let payload = [...packetId];
    for (const t of topics) {
      const topicBytes = new TextEncoder().encode(t);
      payload.push((topicBytes.length >> 8) & 0xff, topicBytes.length & 0xff, ...topicBytes, 0x00);
    }
    let x = payload.length;
    const encodedLen = [];
    do {
      let digit = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) digit = digit | 0x80;
      encodedLen.push(digit);
    } while (x > 0);

    this.ws.send(new Uint8Array([0x82, ...encodedLen, ...payload]));
  }

  flushQueue() {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      this.sendPacket(item.topic, item.messageStr, item.retain);
    }
  }

  publish(topic, messageStr, retain = true) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue latest message per topic so it sends immediately upon connection
      this.queue = this.queue.filter(q => q.topic !== topic);
      this.queue.push({ topic, messageStr, retain });

      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
      return false;
    }

    return this.sendPacket(topic, messageStr, retain);
  }

  sendPacket(topic, messageStr, retain = true) {
    try {
      const topicBytes = new TextEncoder().encode(topic);
      const msgBytes = new TextEncoder().encode(messageStr);

      const varLen = 2 + topicBytes.length + msgBytes.length;
      const encodedLen = [];
      let x = varLen;
      do {
        let digit = x % 128;
        x = Math.floor(x / 128);
        if (x > 0) digit = digit | 0x80;
        encodedLen.push(digit);
      } while (x > 0);

      const packet = new Uint8Array(1 + encodedLen.length + 2 + topicBytes.length + msgBytes.length);
      let offset = 0;
      packet[offset++] = 0x30 | (retain ? 0x01 : 0x00);
      for (let b of encodedLen) packet[offset++] = b;
      packet[offset++] = (topicBytes.length >> 8) & 0xff;
      packet[offset++] = topicBytes.length & 0xff;
      packet.set(topicBytes, offset);
      offset += topicBytes.length;
      packet.set(msgBytes, offset);

      this.ws.send(packet);
      return true;
    } catch (e) {
      console.warn('[YT-OBS Service Worker] Send packet error:', e);
      return false;
    }
  }
}

const brokers = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];

// Single universal channel for all YouTube & YouTube Music overlays
const CHANNEL_ID = 'yt-overlay';
let lastTrack = null;

// Force single channel in sync storage to remove any legacy 'ytm-music' channel
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.set({ channelId: CHANNEL_ID });
}

const client = new NativeMQTTClient(brokers, CHANNEL_ID);

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.action === 'track_update') {
    lastTrack = msg.data;
    const payload = JSON.stringify(msg.data);
    // Publish exclusively to the single canonical channel
    const pub1 = client.publish(`yt/overlay/${CHANNEL_ID}`, payload, true);
    const pub2 = client.publish(`ytm/overlay/${CHANNEL_ID}`, payload, true);
    sendResponse({
      success: pub1 || pub2,
      connected: client.connected,
      channelId: CHANNEL_ID
    });
    return true;
  }

  if (msg.action === 'get_status') {
    sendResponse({
      connected: client.connected,
      broker: client.brokers[client.brokerIdx],
      channelId: CHANNEL_ID,
      lastTrack: lastTrack
    });
    return true;
  }

  if (msg.action === 'force_update') {
    if (msg.theme || msg.accent) {
      const themePayload = JSON.stringify({
        theme: msg.theme || (lastTrack ? lastTrack.theme : 'default'),
        accent: msg.accent || (lastTrack ? lastTrack.accent : '#ff0055')
      });
      client.publish(`yt/overlay/${CHANNEL_ID}/theme`, themePayload, true);
      client.publish(`ytm/overlay/${CHANNEL_ID}/theme`, themePayload, true);
    }
    if (lastTrack) {
      if (msg.theme) lastTrack.theme = msg.theme;
      if (msg.accent) lastTrack.accent = msg.accent;
      if (msg.autohide !== undefined) lastTrack.autohide = msg.autohide;
      const payload = JSON.stringify(lastTrack);
      client.publish(`yt/overlay/${CHANNEL_ID}`, payload, true);
      client.publish(`ytm/overlay/${CHANNEL_ID}`, payload, true);
    }
    sendResponse({ success: true, connected: client.connected });
    return true;
  }
});

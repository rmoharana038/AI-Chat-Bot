const fs = require('fs');
const path = require('path');

// Read token from .env
const envPath = fs.existsSync(path.resolve(__dirname, '../.env'))
  ? path.resolve(__dirname, '../.env')
  : path.resolve('D:/Gemini/AI-Chat-Bot/.env');
const env = fs.readFileSync(envPath, 'utf8');
const tokenMatch = env.match(/FB_PAGE_ACCESS_TOKEN=(.+)/);
if (!tokenMatch) {
  console.error('FB_PAGE_ACCESS_TOKEN not found in .env');
  process.exit(1);
}
const token = tokenMatch[1].trim();
const PAGE_ID = '640383429165346';
const GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAllConversations() {
  console.log('🔍 Fetching all conversations from Meta Graph API...');
  let url = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,updated_time&limit=50&access_token=${encodeURIComponent(token)}`;
  const all = [];

  while (url && all.length < 500) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      console.error('Error fetching conversations:', data.error);
      break;
    }
    const convs = data.data || [];
    all.push(...convs);
    url = data.paging?.next;
    if (!convs.length) break;
  }

  console.log(`✅ Total conversations retrieved: ${all.length}`);
  return all;
}

async function sendMessage(recipientId, text) {
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE'
    })
  });
  return res.json();
}

async function runBroadcast() {
  const convs = await fetchAllConversations();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Filter users active in the last 24h
  const recipients = [];
  const seenPsids = new Set();

  for (const c of convs) {
    const user = c.participants?.data?.find(p => p.id !== PAGE_ID);
    if (!user || !user.id) continue;
    if (seenPsids.has(user.id)) continue;
    seenPsids.add(user.id);

    const updatedTime = new Date(c.updated_time).getTime();
    const isWithin24h = (now - updatedTime) <= dayMs;

    recipients.push({
      name: user.name || 'User',
      psid: user.id,
      updatedTime: c.updated_time,
      isWithin24h
    });
  }

  const activeRecipients = recipients.filter(r => r.isWithin24h);
  console.log(`\n📊 Target Audience:`);
  console.log(`- Unique Users in Inbox: ${recipients.length}`);
  console.log(`- Active within 24-hour Standard Window: ${activeRecipients.length}`);
  console.log(`- Outside 24-hour Window (Skipped to protect Page status): ${recipients.length - activeRecipients.length}\n`);

  const messageText = `Hey! 🥰\n\n✅Follow ❤️👉 https://www.facebook.com/Sujata.Vibes`;

  let successCount = 0;
  let failCount = 0;
  const results = [];

  console.log(`🚀 Starting Broadcast to ${activeRecipients.length} users with rate-limiting safety delay (1.2s)...\n`);

  for (let i = 0; i < activeRecipients.length; i++) {
    const user = activeRecipients[i];
    process.stdout.write(`[${i + 1}/${activeRecipients.length}] Sending to ${user.name} (${user.psid})... `);

    try {
      const result = await sendMessage(user.psid, messageText);
      if (result.message_id) {
        console.log(`✅ Sent (MID: ${result.message_id.substring(0, 15)}...)`);
        successCount++;
        results.push({ user: user.name, psid: user.psid, status: 'sent', mid: result.message_id });
      } else {
        const errMsg = result.error?.message || JSON.stringify(result);
        console.log(`❌ Failed: ${errMsg}`);
        failCount++;
        results.push({ user: user.name, psid: user.psid, status: 'failed', error: errMsg });
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      failCount++;
      results.push({ user: user.name, psid: user.psid, status: 'error', error: err.message });
    }

    // Safety pause: 1200ms between sends to prevent triggering spam detection
    await sleep(1200);
  }

  console.log(`\n========================================`);
  console.log(`🎉 Broadcast Completed!`);
  console.log(`✅ Successfully Sent: ${successCount}`);
  console.log(`❌ Failed / Blocked: ${failCount}`);
  console.log(`========================================\n`);

  // Save report
  fs.writeFileSync(
    path.resolve(__dirname, 'broadcast_report.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), totalTargeted: activeRecipients.length, successCount, failCount, results }, null, 2)
  );
}

runBroadcast();

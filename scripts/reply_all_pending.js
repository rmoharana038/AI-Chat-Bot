import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import {
  detectUserLanguage,
  buildGirlfriendPrompt,
  cleanGirlfriendReply,
  contextualizeUserMessage,
  formatGeminiContents,
  callGemini,
  handleIncomingMessage
} from '../server.js';
import { getUser } from '../src/services/userStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAGE_ID = '640383429165346';
const GRAPH_BASE_URL = 'https://graph.facebook.com/v21.0';
const token = process.env.FB_PAGE_ACCESS_TOKEN?.trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendFbAction(recipientId, action) {
  const url = `${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(token)}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      sender_action: action
    })
  }).catch(() => {});
}

async function sendFbText(recipientId, text) {
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

async function run() {
  console.log('=============================================================');
  console.log('💌 Maira Dash - Check & Reply to All Pending Messages');
  console.log('=============================================================\n');

  if (!token) {
    console.error('❌ Error: FB_PAGE_ACCESS_TOKEN is missing in environment/.env');
    return;
  }

  console.log('🔍 Connecting to Meta Graph API to fetch conversations...');
  let convUrl = `${GRAPH_BASE_URL}/me/conversations?fields=id,participants,updated_time,messages.limit(5){id,message,attachments{id,name,image_data,file_url,mime_type},shares,sticker,from,created_time}&limit=25&access_token=${encodeURIComponent(token)}`;

  const convs = [];
  while (convUrl && convs.length < 500) {
    let res;
    try {
      res = await fetch(convUrl);
    } catch (netErr) {
      console.error('❌ Network error connecting to Graph API:', netErr.message);
      break;
    }

    const data = await res.json();
    if (data.error) {
      console.error('\n❌ Meta Graph API Error (Code ' + data.error.code + '):', data.error.message);
      if (data.error.code === 190) {
        console.error('\n⚠️ [AUTHENTICATION REQUIRED]');
        console.error('The Facebook Page Access Token has expired or its permissions were revoked by Meta.');
        console.error('To resume automatic message replies, please generate a fresh Page Access Token with:');
        console.error('  - pages_messaging');
        console.error('  - pages_read_engagement');
        console.error('  - pages_manage_metadata');
        console.error('  - pages_show_list');
        console.error('and update FB_PAGE_ACCESS_TOKEN in .env and Render environment.\n');
      }
      return { success: false, error: data.error };
    }

    const batch = data.data || [];
    convs.push(...batch);
    convUrl = data.paging?.next;
    if (!batch.length) break;
  }

  console.log(`📥 Retrieved ${convs.length} conversations from Messenger.\n`);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const pendingList = [];

  for (const c of convs) {
    const msgs = c.messages?.data || [];
    if (!msgs.length) continue;

    const latest = msgs[0];
    const otherUser = c.participants?.data?.find(p => p.id !== PAGE_ID);
    if (!otherUser || !otherUser.id) continue;

    // Is the latest message from the user (unanswered)?
    if (latest.from?.id !== PAGE_ID) {
      const msgTime = new Date(latest.created_time).getTime();
      const ageHours = ((now - msgTime) / (1000 * 3600)).toFixed(1);
      const isWithin24h = (now - msgTime) <= dayMs;

      pendingList.push({
        convId: c.id,
        user: otherUser.name || 'User',
        psid: otherUser.id,
        latest,
        history: msgs.slice().reverse(), // oldest to newest
        ageHours,
        isWithin24h
      });
    }
  }

  console.log(`📊 Pending Messages Breakdown:`);
  console.log(`- Total unanswered user messages: ${pendingList.length}`);
  console.log(`- Within 24-hour standard window:  ${pendingList.filter(p => p.isWithin24h).length}`);
  console.log(`- Outside 24-hour window:          ${pendingList.filter(p => !p.isWithin24h).length} (Skipped for Meta policy compliance)\n`);

  const activePending = pendingList.filter(p => p.isWithin24h);
  if (activePending.length === 0) {
    console.log('✨ No pending messages within the active 24-hour window! All caught up.\n');
    return { success: true, repliedCount: 0, pendingList };
  }

  let repliedCount = 0;
  let failCount = 0;
  const report = [];

  for (let i = 0; i < activePending.length; i++) {
    const item = activePending[i];
    const userMsgContext = contextualizeUserMessage(item.latest.message, item.latest);
    const userState = getUser(item.psid);
    const langInfo = detectUserLanguage(item.latest.message || '', item.history, userState);

    console.log(`-------------------------------------------------------------`);
    console.log(`[${i + 1}/${activePending.length}] Replying to ${item.user} (PSID: ${item.psid})`);
    console.log(`   🌐 Language: ${langInfo.name} (${langInfo.code})`);
    console.log(`   📩 User said: "${item.latest.message || userMsgContext}" (${item.ageHours} hrs ago)`);

    await sendFbAction(item.psid, 'mark_seen');
    await sendFbAction(item.psid, 'typing_on');

    const contents = formatGeminiContents(item.history, userMsgContext);
    const rawReply = await callGemini(contents, item.user, langInfo, userState, false, userState.personaMode || 'default');

    if (!rawReply) {
      console.log(`   ⚠️ Gemini failed to generate reply, skipping.`);
      await sendFbAction(item.psid, 'typing_off');
      failCount++;
      continue;
    }

    const cleanedReply = cleanGirlfriendReply(rawReply);
    console.log(`   💬 Maira reply: "${cleanedReply}"`);

    const sendRes = await sendFbText(item.psid, cleanedReply);
    await sendFbAction(item.psid, 'typing_off');

    if (sendRes.message_id) {
      console.log(`   ✅ Delivered (MID: ${sendRes.message_id.substring(0, 20)}...)\n`);
      repliedCount++;
      report.push({
        user: item.user,
        psid: item.psid,
        userMsg: item.latest.message,
        reply: cleanedReply,
        language: langInfo.name,
        mid: sendRes.message_id
      });
    } else {
      console.log(`   ❌ Send Error: ${sendRes.error?.message || JSON.stringify(sendRes)}\n`);
      failCount++;
      report.push({ user: item.user, psid: item.psid, error: sendRes.error?.message });
    }

    await sleep(1500); // 1.5s rate-limit pause between messages
  }

  console.log(`=============================================================`);
  console.log(`🎉 Check & Reply Summary:`);
  console.log(`   ✅ Successfully Replied: ${repliedCount}`);
  console.log(`   ❌ Failed / Skipped:     ${failCount}`);
  console.log(`=============================================================\n`);

  fs.writeFileSync(
    path.resolve(__dirname, 'pending_replies_report.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), totalReplied: repliedCount, report }, null, 2)
  );

  return { success: true, repliedCount, report };
}

run().catch(console.error);

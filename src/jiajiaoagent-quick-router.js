const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const JIAJIAOAGENT_REPO_ROOT = 'I:\\jiajiaoagent';
const JIAJIAOAGENT_BACKEND_ROOT = path.join(JIAJIAOAGENT_REPO_ROOT, 'backend');
const JIAJIAOAGENT_BRIDGE_STATE_PATH = path.join(JIAJIAOAGENT_BACKEND_ROOT, '.bridge-state.json');
const JIAJIAOAGENT_BOOK_DATASET_PATH = path.join(JIAJIAOAGENT_REPO_ROOT, 'samples', 'light-rag', 'unite-books.dataset.json');
const JIAJIAOAGENT_DEFAULT_TOPIC_ID = 'my-family';
const JIAJIAOAGENT_DEFAULT_OPENING = 'Hello! I am your English speaking buddy. We can talk about anything you like. What do you want to chat about today?';
const JIAJIAOAGENT_BOOK_ALIAS_CONFIG = {
  173: { aliases: ['i can help', 'help', '我会帮忙', '帮忙'], topicHint: 'home-help' },
  2007: { aliases: ['going to school', 'school', '上学', '去学校'], topicHint: 'school-day' },
  126: { aliases: ['spot the shapes', 'shapes', '形状', '找形状'], topicHint: 'shapes' }
};
const JIAJIAOAGENT_VOICE_OPTIONS = [
  { key: '1', voiceName: 'en-US-AriaNeural', label: 'Aria', preview: '自然, 通用感最强' },
  { key: '2', voiceName: 'en-US-JennyNeural', label: 'Jenny', preview: '清楚, 稳, 像温和老师' },
  { key: '3', voiceName: 'en-US-AnaNeural', label: 'Ana', preview: '更轻一点, 更偏低龄感' }
];
const JIAJIAOAGENT_SPEED_OPTIONS = [
  { key: '1', presetName: 'slow', label: '慢速' },
  { key: '2', presetName: 'normal', label: '正常' },
  { key: '3', presetName: 'fast', label: '快速' }
];
const JIAJIAOAGENT_QUICK_PATTERNS = {
  restart: ['重新开始聊天', '重新开始', '重新聊', '重新开聊', '重新来', '开始新聊天', '开始新的聊天', 'new chat', 'start over', 'restart chat', 'reset chat'],
  bookMenu: ['绘本', '开始绘本', '开启绘本', 'book'],
  currentSettings: ['当前语音', '当前设置', '语音设置', '现在的音色', '现在的语速', 'current voice', 'current settings'],
  bookExit: ['退出绘本', '结束绘本', 'exit book'],
  bookNext: ['下一页', 'next page'],
  bookPrevious: ['上一页', 'previous page'],
  bookRepeat: ['再读一遍', 'repeat', 'read again']
};
const JIAJIAOAGENT_QUICK_REGEX = {
  bookStartZh: /^开始绘本\s+(.+)$/i,
  bookOpenZh: /^开启绘本\s+(.+)$/i,
  bookStartEn: /^start\s+book\s+(.+)$/i
};

let booksCache = null;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeControlCommand(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 65248))
    .replace(/["'“”‘’]/g, '')
    .replace(/[，。！？；：]/g, ' ')
    .replace(/\s+/g, ' ');
}

function extractCommandChoice(normalized, keywords) {
  const matchedKeyword = keywords.find((keyword) => normalized.includes(keyword));
  if (!matchedKeyword) return null;
  const keywordIndex = normalized.indexOf(matchedKeyword);
  const remainder = normalized.slice(keywordIndex + matchedKeyword.length);
  const match = remainder.match(/[123一二三]/);
  if (!match) return null;
  switch (match[0]) {
    case '1':
    case '一':
      return '1';
    case '2':
    case '二':
      return '2';
    case '3':
    case '三':
      return '3';
    default:
      return null;
  }
}

function getSenderKey(senderId) {
  return `qq:${String(senderId)}`;
}

function loadBridgeState() {
  try {
    if (!fs.existsSync(JIAJIAOAGENT_BRIDGE_STATE_PATH)) {
      return { sessionsBySender: {} };
    }
    return JSON.parse(fs.readFileSync(JIAJIAOAGENT_BRIDGE_STATE_PATH, 'utf8'));
  } catch {
    return { sessionsBySender: {} };
  }
}

function saveBridgeState(state) {
  fs.writeFileSync(JIAJIAOAGENT_BRIDGE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function mapTopicHintToTopicId(topicHint) {
  switch (topicHint) {
    case 'home-help':
      return 'my-family';
    case 'school-day':
      return 'my-school-day';
    case 'shapes':
      return 'hobbies-and-play';
    default:
      return JIAJIAOAGENT_DEFAULT_TOPIC_ID;
  }
}

function isUsablePageText(text) {
  const normalized = normalizeText(text);
  return Boolean(normalized) && !normalized.includes('unite for literacy') && !normalized.includes('copyright');
}

function loadBooks() {
  if (booksCache) return booksCache;
  try {
    const raw = fs.readFileSync(JIAJIAOAGENT_BOOK_DATASET_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const chunks = Array.isArray(parsed && parsed.chunks) ? parsed.chunks : [];
    const grouped = new Map();
    for (const chunk of chunks) {
      if (!chunk || !JIAJIAOAGENT_BOOK_ALIAS_CONFIG[chunk.bookId] || !isUsablePageText(chunk.text)) continue;
      const list = grouped.get(chunk.bookId) || [];
      list.push(chunk);
      grouped.set(chunk.bookId, list);
    }
    booksCache = Array.from(grouped.entries()).map(([bookId, bookChunks]) => {
      const first = bookChunks[0];
      const aliasConfig = JIAJIAOAGENT_BOOK_ALIAS_CONFIG[bookId];
      return {
        bookId,
        title: first.bookTitle,
        topicHint: aliasConfig.topicHint,
        topicId: mapTopicHintToTopicId(aliasConfig.topicHint),
        aliases: aliasConfig.aliases.map(normalizeText),
        pages: bookChunks.sort((a, b) => a.pageNum - b.pageNum).map((chunk) => ({
          pageNum: chunk.pageNum,
          text: chunk.text,
          sourceUrl: chunk.sourceUrl
        }))
      };
    });
  } catch {
    booksCache = [];
  }
  return booksCache;
}

function resolveBook(query) {
  const normalized = normalizeText(query);
  if (!normalized) return null;
  return loadBooks().find((book) => book.aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized))) || null;
}

function buildBookMenuText() {
  const titles = loadBooks().map((book) => `- ${book.title}`).join('\n');
  return `可用绘本:\n${titles}\n请直接发送书名开始，比如：I Can Help`;
}

function buildBookQuestion(book, page) {
  if (String(page.text || '').endsWith('?')) return page.text;
  if (book.topicHint === 'home-help') return 'What can the child do in this page?';
  if (book.topicHint === 'school-day') return 'What is happening at school in this page?';
  return 'What shape or object do you hear in this page?';
}

function buildLifeQuestion(book, page) {
  const text = String(page.text || '');
  if (book.topicHint === 'home-help') {
    if (/wash the dishes/i.test(text)) return 'How do you help at home?';
    if (/washing machine/i.test(text)) return 'What clothes do you help wash at home?';
    if (/set the table/i.test(text)) return 'Do you help set the table at home?';
    return 'What can you do to help your family?';
  }
  if (book.topicHint === 'school-day') {
    if (/bus/i.test(text)) return 'How do you go to school?';
    if (/lunch/i.test(text)) return 'What do you eat at school?';
    return 'What is your school day like?';
  }
  if (/circle/i.test(text)) return 'Where can you see circles in your life?';
  if (/square/i.test(text)) return 'Where can you see squares at home or school?';
  if (/triangle/i.test(text)) return 'Can you find a triangle near you?';
  return 'What shapes can you see around you?';
}

function buildBookStartReply(book, bookState) {
  const page = book.pages[bookState.currentPageIndex];
  return [
    `我们来练绘本《${book.title}》第 ${page.pageNum} 页。`,
    `先跟我读这一句: ${page.text}`,
    '你先直接跟读发给我。',
    '如果想再听一遍，就发“再读一遍”。'
  ].join('\n');
}

function getVoiceLabel(voiceName) {
  const match = JIAJIAOAGENT_VOICE_OPTIONS.find((option) => option.voiceName === voiceName);
  return match ? `${match.label} (${match.voiceName})` : voiceName;
}

function getSpeedLabel(presetName) {
  const match = JIAJIAOAGENT_SPEED_OPTIONS.find((option) => option.presetName === presetName);
  return match ? match.label : presetName;
}

function buildVoiceMenuText(session) {
  const currentLabel = getVoiceLabel(session.voiceName);
  const options = JIAJIAOAGENT_VOICE_OPTIONS.map((option) => `${option.key}. ${option.label} - ${option.preview}`).join('\n');
  return `当前音色: ${currentLabel}\n请选择音色:\n${options}\n发送“音色 1”或“音色 2”或“音色 3”`;
}

function buildSpeedMenuText(session) {
  const currentLabel = getSpeedLabel(session.speechRatePreset);
  const options = JIAJIAOAGENT_SPEED_OPTIONS.map((option) => `${option.key}. ${option.label}`).join('\n');
  return `当前语速: ${currentLabel}\n请选择语速:\n${options}\n发送“语速 1”或“语速 2”或“语速 3”`;
}

function buildCurrentSettingsText(session) {
  return `当前音色: ${getVoiceLabel(session.voiceName)}\n当前语速: ${getSpeedLabel(session.speechRatePreset)}`;
}

function moveBookPage(state, book, direction) {
  const delta = direction === 'next' ? 1 : -1;
  const nextIndex = Math.min(Math.max(state.currentPageIndex + delta, 0), book.pages.length - 1);
  return { ...state, currentPageIndex: nextIndex, stage: 'introduced' };
}

function ensureSession(state, senderId) {
  const senderKey = getSenderKey(senderId);
  if (state.sessionsBySender[senderKey]) return state.sessionsBySender[senderKey];
  const session = {
    sessionId: randomUUID(),
    topicId: JIAJIAOAGENT_DEFAULT_TOPIC_ID,
    currentLevel: 2,
    voiceName: 'en-US-AriaNeural',
    speechRatePreset: 'normal',
    turnIndex: 0,
    recentTurns: [{ speaker: 'agent', text: JIAJIAOAGENT_DEFAULT_OPENING }],
    bookPractice: null,
    bookPracticeSelectionPending: false,
    updatedAt: new Date().toISOString()
  };
  state.sessionsBySender[senderKey] = session;
  return session;
}

function parseQuickControl(text) {
  const trimmed = String(text || '').trim();
  const normalized = normalizeControlCommand(text);
  if (!normalized) return null;
  if (JIAJIAOAGENT_QUICK_PATTERNS.restart.some((pattern) => normalized.includes(pattern))) return { action: 'restart' };
  if (JIAJIAOAGENT_QUICK_PATTERNS.bookMenu.includes(normalized)) return { action: 'book_menu' };
  if (normalized === '音色' || normalized === 'voice') return { action: 'voice_menu' };
  if (normalized === '语速' || normalized === 'speed') return { action: 'speed_menu' };
  const voiceChoice = extractCommandChoice(normalized, ['音色', 'voice']);
  if (voiceChoice) return { action: 'voice_select', choice: voiceChoice };
  const speedChoice = extractCommandChoice(normalized, ['语速', 'speed']);
  if (speedChoice) return { action: 'speed_select', choice: speedChoice };
  const asksForCurrentState = normalized.includes('当前') && ['语音', '设置', '音色', '语速'].some((keyword) => normalized.includes(keyword));
  if (asksForCurrentState) return { action: 'current_settings' };
  if (JIAJIAOAGENT_QUICK_PATTERNS.currentSettings.some((pattern) => normalized === pattern || normalized.includes(pattern))) return { action: 'current_settings' };
  const zhStartMatch = trimmed.match(JIAJIAOAGENT_QUICK_REGEX.bookStartZh);
  if (zhStartMatch) return { action: 'book_start', bookQuery: zhStartMatch[1].trim() };
  const zhOpenMatch = trimmed.match(JIAJIAOAGENT_QUICK_REGEX.bookOpenZh);
  if (zhOpenMatch) return { action: 'book_start', bookQuery: zhOpenMatch[1].trim() };
  const enStartMatch = trimmed.match(JIAJIAOAGENT_QUICK_REGEX.bookStartEn);
  if (enStartMatch) return { action: 'book_start', bookQuery: enStartMatch[1].trim() };
  if (JIAJIAOAGENT_QUICK_PATTERNS.bookExit.includes(normalized)) return { action: 'book_exit' };
  if (JIAJIAOAGENT_QUICK_PATTERNS.bookNext.includes(normalized)) return { action: 'book_next' };
  if (JIAJIAOAGENT_QUICK_PATTERNS.bookPrevious.includes(normalized)) return { action: 'book_previous' };
  if (JIAJIAOAGENT_QUICK_PATTERNS.bookRepeat.includes(normalized)) return { action: 'book_repeat' };
  return null;
}

async function handleJiajiaoagentQuickControl(senderId, content, sendMessage) {
  const control = parseQuickControl(content);
  if (!control) return false;
  const state = loadBridgeState();
  const senderKey = getSenderKey(senderId);

  if (control.action === 'restart') {
    delete state.sessionsBySender[senderKey];
    saveBridgeState(state);
    await sendMessage(senderId, "Okay, let's start a new chat now.", 'jiajiaoagent_restart_local');
    return true;
  }

  const session = ensureSession(state, senderId);

  if (session.bookPracticeSelectionPending) {
    const selectedBook = resolveBook(content);
    if (selectedBook) {
      return false;
    }
  }

  if (control.action === 'book_menu') {
    session.bookPractice = null;
    session.bookPracticeSelectionPending = true;
    session.updatedAt = new Date().toISOString();
    state.sessionsBySender[senderKey] = session;
    saveBridgeState(state);
    await sendMessage(senderId, buildBookMenuText(), 'jiajiaoagent_book_menu_local');
    return true;
  }
  if (control.action === 'voice_menu') {
    await sendMessage(senderId, buildVoiceMenuText(session), 'jiajiaoagent_voice_menu_local');
    return true;
  }
  if (control.action === 'speed_menu') {
    await sendMessage(senderId, buildSpeedMenuText(session), 'jiajiaoagent_speed_menu_local');
    return true;
  }
  if (control.action === 'voice_select') {
    const option = JIAJIAOAGENT_VOICE_OPTIONS.find((item) => item.key === control.choice) || JIAJIAOAGENT_VOICE_OPTIONS[0];
    session.voiceName = option.voiceName;
    session.updatedAt = new Date().toISOString();
    state.sessionsBySender[senderKey] = session;
    saveBridgeState(state);
    await sendMessage(senderId, `已切换到 ${option.label}。\n${buildCurrentSettingsText(session)}`, 'jiajiaoagent_voice_select_local');
    return true;
  }
  if (control.action === 'speed_select') {
    const option = JIAJIAOAGENT_SPEED_OPTIONS.find((item) => item.key === control.choice) || JIAJIAOAGENT_SPEED_OPTIONS[1];
    session.speechRatePreset = option.presetName;
    session.updatedAt = new Date().toISOString();
    state.sessionsBySender[senderKey] = session;
    saveBridgeState(state);
    await sendMessage(senderId, `已切换到${getSpeedLabel(session.speechRatePreset)}。\n${buildCurrentSettingsText(session)}`, 'jiajiaoagent_speed_select_local');
    return true;
  }
  if (control.action === 'current_settings') {
    await sendMessage(senderId, buildCurrentSettingsText(session), 'jiajiaoagent_current_settings_local');
    return true;
  }
  if (control.action === 'book_start') {
    const book = resolveBook(control.bookQuery);
    if (!book) {
      await sendMessage(senderId, `我还没认出这本书。\n${buildBookMenuText()}`, 'jiajiaoagent_book_start_unknown_local');
      return true;
    }
    return false;
  }
  if (control.action === 'book_exit') {
    session.bookPractice = null;
    session.bookPracticeSelectionPending = false;
    session.updatedAt = new Date().toISOString();
    state.sessionsBySender[senderKey] = session;
    saveBridgeState(state);
    await sendMessage(senderId, '好的，先退出绘本模式。你想继续自由聊天也可以，想重新进绘本就发“开始绘本 ...”。', 'jiajiaoagent_book_exit_local');
    return true;
  }
  if (control.action === 'book_next' || control.action === 'book_previous' || control.action === 'book_repeat') {
    const activeBookState = session.bookPractice;
    const activeBook = activeBookState ? loadBooks().find((book) => book.bookId === activeBookState.bookId) : null;
    if (!activeBookState || !activeBook || !activeBookState.active) {
      await sendMessage(senderId, `你还没有开始绘本练习。\n${buildBookMenuText()}`, 'jiajiaoagent_book_missing_local');
      return true;
    }
    return false;
  }
  return false;
}

module.exports = {
  handleJiajiaoagentQuickControl
};

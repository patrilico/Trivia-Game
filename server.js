// server.js

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const QRCode = require('qrcode');
const os = require('os');
const questionBanks = require('./question-banks');

const PORT = process.env.PORT || 3000;

// Serve static files from "public" directory
app.use(express.static('public'));

// Helper: get the machine's LAN IPv4 address
function getLocalExternalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Endpoint to generate QR code for easy device join
app.get('/qr', async (req, res) => {
  try {
    const ip = getLocalExternalIp();                  // e.g. "192.168.1.80"
    const url = `http://${ip}:${PORT}`;
    const qrDataUrl = await QRCode.toDataURL(url);
    res.json({ qr: qrDataUrl });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Game state
let players = {};
let gameInProgress = false;
let currentQuestionIndex = 0;
let totalQuestions = 0;
let totalQuestionsAsked = 0;
let questionTimer = null;
let nextRoundTimer = null;

let activeBankId = 'game-1';
if (!questionBanks[activeBankId]) {
  activeBankId = Object.keys(questionBanks)[0];
}
let activeQuestions = questionBanks[activeBankId].questions;
totalQuestions = activeQuestions.length;

function setActiveBank(bankId) {
  if (!questionBanks[bankId]) return false;
  activeBankId = bankId;
  activeQuestions = questionBanks[bankId].questions;
  totalQuestions = activeQuestions.length;
  currentQuestionIndex = 0;
  totalQuestionsAsked = 0;
  return true;
}

app.get('/banks', (req, res) => {
  const banks = Object.values(questionBanks).map(b => ({
    id: b.id,
    name: b.name,
    questionCount: b.questions.length
  }));
  res.json({ banks, activeBankId });
});

// Helpers
function allPlayersReady() {
  return Object.values(players).length > 0 &&
         Object.values(players).every(p => p.ready);
}
function allPlayersAnswered() {
  return Object.values(players).length > 0 &&
         Object.values(players).every(p => p.answered);
}

// Send next question
function sendNextQuestion() {
  Object.values(players).forEach(p => p.answered = false);
  const q = activeQuestions[currentQuestionIndex];
  io.emit('new-question', { question: q, index: currentQuestionIndex, totalQuestions });
  questionTimer = setTimeout(endQuestion, 30000);
}

// End question
function endQuestion() {
  const currentQ = activeQuestions[currentQuestionIndex];
  io.emit('show-answer', { correctAnswer: currentQ.answer, index: currentQuestionIndex });
  totalQuestionsAsked = currentQuestionIndex + 1;
  io.emit('scoreboard', { players, totalAsked: totalQuestionsAsked, totalQuestions });
  currentQuestionIndex++;
  if (currentQuestionIndex < totalQuestions) {
    io.emit('next-round-countdown', { seconds: 7, current: currentQuestionIndex, totalQuestions });
    nextRoundTimer = setTimeout(sendNextQuestion, 7000);
  } else {
    io.emit('game-over', { players });
    gameInProgress = false;
  }
}

// Socket.IO events
io.on('connection', socket => {
  console.log('User connected:', socket.id);

  socket.on('join', data => {
    const isFirstPlayer = Object.keys(players).length === 0;
    if (!gameInProgress && isFirstPlayer && data.bankId) {
      setActiveBank(data.bankId);
    }
    players[socket.id] = { name: data.name, score: 0, answered: false, ready: false, correct: 0 };
    io.emit('scoreboard', { players, totalAsked: totalQuestionsAsked, totalQuestions });
    socket.emit('bank-info', {
      bankId: activeBankId,
      bankName: questionBanks[activeBankId].name,
      questionCount: totalQuestions
    });
  });

  socket.on('player-ready', () => {
    if (!players[socket.id]) return;
    players[socket.id].ready = true;
    io.emit('scoreboard', { players, totalAsked: totalQuestionsAsked, totalQuestions });
    if (!gameInProgress && allPlayersReady()) {
      gameInProgress = true;
      currentQuestionIndex = 0;
      totalQuestionsAsked = 0;
      io.emit('start-countdown', { seconds: 5 });
      setTimeout(sendNextQuestion, 5000);
    }
  });

  socket.on('submit-answer', data => {
    if (!players[socket.id] || players[socket.id].answered) return;
    players[socket.id].answered = true;
    const curr = activeQuestions[currentQuestionIndex];
    const secsTaken = 30 - data.timeLeft;
    let pts = 0;
    if (data.answer === curr.answer) {
      pts = Math.floor((data.timeLeft / 30) * 1000);
      players[socket.id].score += pts;
      players[socket.id].correct += 1;
    }
    socket.emit('answer-result', { points: pts, secondsTaken: secsTaken });
    if (allPlayersAnswered()) {
      clearTimeout(questionTimer);
      endQuestion();
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete players[socket.id];
    io.emit('scoreboard', { players, totalAsked: totalQuestionsAsked, totalQuestions });
  });
});

// Start server
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}. Visit http://localhost:${PORT} or scan QR to join.`);
});

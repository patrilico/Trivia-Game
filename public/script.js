// public/script.js

// 1. Fetch the QR code for easy device join
fetch('/qr')
  .then(res => res.json())
  .then(({ qr }) => {
    const qrImg = document.getElementById('qrCode');
    if (qrImg) qrImg.src = qr;
  })
  .catch(err => console.error('QR fetch error:', err));

// 2. Socket.IO client setup
const socket = io();
let playerName = '';
let selectedAnswer = null;
let currentCorrectAnswer = '';
let bankOptions = [];

// 3. Utility to hide all screens
function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  document.getElementById('pointsEarned').style.display = 'none';
}

// 4. Timer & progress bar logic
let timerInterval, progressInterval;
function startTimer(seconds) {
  let remaining = seconds;
  const timerEl = document.getElementById('timer');
  const pb = document.getElementById('progress-bar');
  timerEl.innerText = remaining;
  clearInterval(timerInterval);
  clearInterval(progressInterval);
  pb.style.width = '100%';
  const step = 100 / seconds;
  timerInterval = setInterval(() => {
    remaining--;
    timerEl.innerText = remaining;
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);
  progressInterval = setInterval(() => {
    let w = parseFloat(pb.style.width);
    if (w > 0) pb.style.width = (w - step) + '%';
    else clearInterval(progressInterval);
  }, 1000);
}

// 5. DOM event listeners
document.addEventListener('DOMContentLoaded', () => {
  const bankSelect = document.getElementById('bankSelect');
  const bankNotice = document.getElementById('bankNotice');

  function updateBankNotice(info) {
    if (!bankNotice) return;
    bankNotice.innerText = `Current game: ${info.bankName} (${info.questionCount} questions)`;
  }

  function setBankOptions(banks, activeBankId) {
    if (!bankSelect) return;
    bankSelect.innerHTML = '';
    banks.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.innerText = `${b.name} (${b.questionCount} questions)`;
      bankSelect.appendChild(opt);
    });
    if (activeBankId) bankSelect.value = activeBankId;
  }

  fetch('/banks')
    .then(res => res.json())
    .then(({ banks, activeBankId }) => {
      bankOptions = banks || [];
      setBankOptions(bankOptions, activeBankId);
      const active = bankOptions.find(b => b.id === activeBankId);
      if (active) updateBankNotice(active);
    })
    .catch(err => console.error('Bank fetch error:', err));

  // Join button
  document.getElementById('joinBtn').addEventListener('click', () => {
    const input = document.getElementById('nameInput');
    playerName = input.value.trim();
    if (!playerName) return alert('Please enter your name!');
    socket.emit('join', { name: playerName, bankId: bankSelect ? bankSelect.value : null });
    hideAllScreens();
    document.getElementById('playerNameDisplay').innerText = playerName;
    document.getElementById('ready-screen').style.display = 'block';
  });

  // Ready button
  document.getElementById('readyBtn').addEventListener('click', () => {
    socket.emit('player-ready');
    const btn = document.getElementById('readyBtn');
    btn.disabled = true;
    btn.innerText = 'Waiting for others...';
  });

  // Modal close
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('modal').style.display = 'none';
  });
});

// 6. Game event handlers
socket.on('start-countdown', data => {
  hideAllScreens();
  document.getElementById('game-area').style.display = 'block';
  startTimer(data.seconds);
});

socket.on('new-question', data => {
  selectedAnswer = null;
  currentCorrectAnswer = data.question.answer;
  document.getElementById('questionText').innerText = data.question.question;
  document.getElementById('questionCount').innerText = `Question ${data.index+1} of ${data.totalQuestions}`;
  const opts = document.getElementById('options');
  opts.innerHTML = '';
  data.question.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerText = opt;
    btn.onclick = () => submitAnswer(opt);
    opts.appendChild(btn);
  });
  document.getElementById('countdownLabel').innerText = '';
  document.getElementById('pointsEarned').style.display = 'none';
  startTimer(30);
  navigator.vibrate(200);
});

function submitAnswer(answer) {
  selectedAnswer = answer;
  const timeLeft = parseInt(document.getElementById('timer').innerText, 10);
  socket.emit('submit-answer', { answer, timeLeft });
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
  document.querySelectorAll('.option-btn').forEach(btn => {
    if (btn.innerText === currentCorrectAnswer) {
      btn.style.background = '#28a745'; btn.style.color = '#fff';
    } else if (btn.innerText === answer) {
      btn.style.background = '#dc3545'; btn.style.color = '#fff';
    }
  });
}

socket.on('answer-result', data => {
  const pe = document.getElementById('pointsEarned');
  pe.innerText = `Points Earned: ${data.points}`;
  pe.style.display = 'block';
  navigator.vibrate(300);
});

socket.on('show-answer', data => {
  if (selectedAnswer === null) {
    document.querySelectorAll('.option-btn').forEach(btn => {
      if (btn.innerText === data.correctAnswer) {
        btn.style.background = '#28a745'; btn.style.color = '#fff';
      }
    });
    const pe = document.getElementById('pointsEarned');
    pe.innerText = 'Points Earned: 0';
    pe.style.display = 'block';
  }
});

socket.on('scoreboard', data => {
  const sb = document.getElementById('scoreboard');
  sb.innerHTML = '';
  const playersData = data && data.players ? data.players : data;
  const totalAsked = data && typeof data.totalAsked === 'number' ? data.totalAsked : null;
  Object.values(playersData)
    .sort((a, b) => b.score - a.score)
    .forEach(p => {
      const li = document.createElement('li');
      const askedText = totalAsked !== null ? totalAsked : '-';
      const correctText = typeof p.correct === 'number' ? p.correct : 0;
      li.innerHTML = `
        <div class="score-name">${p.name}</div>
        <div class="score-stats">
          <span class="score-points">${p.score} pts</span>
          <span class="score-correct">${correctText}/${askedText} correct</span>
        </div>
      `;
      sb.appendChild(li);
    });
});

socket.on('bank-info', data => {
  const bankSelect = document.getElementById('bankSelect');
  const bankNotice = document.getElementById('bankNotice');
  if (bankSelect) bankSelect.value = data.bankId;
  if (bankNotice) {
    bankNotice.innerText = `Current game: ${data.bankName} (${data.questionCount} questions)`;
  }
});

socket.on('next-round-countdown', data => {
  document.getElementById('countdownLabel').innerText = 'Time to Next Question';
  startTimer(data.seconds);
  navigator.vibrate(200);
});

socket.on('game-over', data => {
  const playersArr = Object.values(data.players).sort((a, b) => b.score - a.score);
  const winner = playersArr[0];
  document.getElementById('modalTitle').innerText = 'Game Over';
  document.getElementById('modalMessage').innerText = `Winner: ${winner.name} with ${winner.score} points`;
  document.getElementById('modal').style.display = 'flex';
});

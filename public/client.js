const socket = io();
let mySocketId = null;
let currentGameState = null;
let lastTurnPlayerId = null; // 턴 알림 및 사운드 중복 재생 방지용

// 💡 턴 전환 효과음 객체 생성
const turnSound = new Audio('/sounds/turn.mp3');

let selectedDeltas = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };

const DECK_IMAGES = {
  level1: '/images/101.png',
  level2: '/images/102.png',
  level3: '/images/103.png'
};

socket.on('init', (data) => {
  mySocketId = data.socketId;
  currentGameState = data.gameState;
  render();
});

socket.on('updateGameState', (gameState) => {
  currentGameState = gameState;
  render();
});

socket.on('errorMsg', (msg) => alert(msg));
socket.on('gameOver', (data) => {
  alert(`🎉 게임 종료! 최종 승리자: [${data.character}] ${data.winner} (${data.points}점)`);
});

document.getElementById('btnJoin').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  if (!name) return alert('이름을 입력해주세요.');
  
  socket.emit('joinRoom', name);
  
  document.getElementById('playerName').disabled = true;
  document.getElementById('btnJoin').disabled = true;
});

document.getElementById('btnStart').addEventListener('click', () => socket.emit('startGame'));

function adjustToken(color, change) {
  const currentDelta = selectedDeltas[color];
  const myPlayer = currentGameState ? currentGameState.players.find(p => p.id === mySocketId) : null;
  const bankCount = currentGameState ? (currentGameState.tokens[color] || 0) : 0;
  const myTokenCount = myPlayer ? (myPlayer.tokens[color] || 0) : 0;

  const currentPosSum = Object.values(selectedDeltas).filter(d => d > 0).reduce((a, b) => a + b, 0);
  const currentNegAbs = Math.abs(Object.values(selectedDeltas).filter(d => d < 0).reduce((a, b) => a + b, 0));

  if (change === 1) {
    const otherPosSum = Object.entries(selectedDeltas)
      .filter(([c, d]) => c !== color && d > 0)
      .reduce((sum, [c, d]) => sum + d, 0);

    const hasOtherSameTwo = Object.entries(selectedDeltas)
      .some(([c, d]) => c !== color && d === 2);

    if (currentDelta === 0) {
      if (hasOtherSameTwo) return alert('동일한 토큰 2개를 가져올 때는 다른 토큰을 추가할 수 없습니다.');
      if (otherPosSum >= 3) return alert('토큰은 한 턴에 최대 3개까지만 가져올 수 있습니다.');
      if (bankCount < 1) return alert('은행에 남은 토큰이 없습니다.');
      selectedDeltas[color] = 1;
    } else if (currentDelta === 1) {
      if (otherPosSum > 0) return alert('다른 토큰을 함께 가져올 때는 한 종류당 1개씩만 선택 가능합니다.');
      if (bankCount < 4) return alert('은행에 토큰이 4개 이상 있을 때만 동일 토큰 2개를 가져올 수 있습니다.');
      selectedDeltas[color] = 2;
    }
  } else if (change === -1) {
    if (currentDelta > 0) {
      selectedDeltas[color] -= 1;
      const newPosSum = Object.values(selectedDeltas).filter(d => d > 0).reduce((a, b) => a + b, 0);
      const newNegAbs = Math.abs(Object.values(selectedDeltas).filter(d => d < 0).reduce((a, b) => a + b, 0));

      if (newNegAbs > newPosSum) {
        Object.keys(selectedDeltas).forEach(k => {
          if (selectedDeltas[k] < 0) selectedDeltas[k] = 0;
        });
        alert('+로 선택한 토큰 수량이 줄어들어 반납(-) 선택이 초기화되었습니다.');
      }
    } else {
      if (color === 'master') return alert('마스터볼 토큰은 반납/교환할 수 없습니다.');
      if (currentNegAbs + 1 > currentPosSum) return alert(`반납(-)하는 토큰 수는 가져올(+) 토큰 수(${currentPosSum}개)를 초과할 수 없습니다.`);
      if (myTokenCount + (currentDelta - 1) < 0) return alert('보유 중인 토큰보다 많이 반납할 수 없습니다.');
      selectedDeltas[color] -= 1;
    }
  }
  updateTokenSelectionUI();
}

function discardToken(color) {
  socket.emit('discardToken', color);
}

document.getElementById('btnResetTokens').addEventListener('click', () => {
  selectedDeltas = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };
  updateTokenSelectionUI();
});

document.getElementById('btnConfirmTokens').addEventListener('click', () => {
  socket.emit('takeTokens', selectedDeltas);
  selectedDeltas = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };
  updateTokenSelectionUI();
});

document.getElementById('btnEndTurn').addEventListener('click', () => {
  socket.emit('endTurn');
});

// 채팅 팝업 토글 로직
const btnToggleChat = document.getElementById('btnToggleChat');
const chatPopup = document.getElementById('chat-popup');
const chatPopupClose = document.getElementById('chat-popup-close');

btnToggleChat.addEventListener('click', () => {
  chatPopup.classList.toggle('hidden');
  if (!chatPopup.classList.contains('hidden')) {
    btnToggleChat.innerText = '💬 실시간 채팅창 닫기';
  } else {
    btnToggleChat.innerText = '💬 실시간 채팅창 열기';
  }
});

chatPopupClose.addEventListener('click', () => {
  chatPopup.classList.add('hidden');
  btnToggleChat.innerText = '💬 실시간 채팅창 열기';
});

function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value;
  if (!msg.trim()) return;

  socket.emit('sendChatMessage', msg);
  input.value = '';
}

document.getElementById('btnSendChat').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChat();
});

socket.on('receiveChatMessage', (data) => {
  const chatLogs = document.getElementById('chat-logs');
  if (!chatLogs) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-item';
  msgDiv.innerHTML = `
    <span class="chat-sender">[${data.sender}]</span>
    <span class="chat-text">${data.msg}</span>
    <span class="chat-time">${data.time}</span>
  `;

  chatLogs.appendChild(msgDiv);
  chatLogs.scrollTop = chatLogs.scrollHeight;
});

// 중앙 턴 알림 토스트 팝업 함수
function showTurnToast(text) {
  const toast = document.getElementById('turn-toast');
  const toastText = document.getElementById('turn-toast-text');
  if (!toast || !toastText) return;

  toastText.innerText = text;
  toast.classList.remove('hidden');
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 300);
  }, 1500);
}

function updateTokenSelectionUI() {
  Object.keys(selectedDeltas).forEach(color => {
    const statusEl = document.getElementById(`delta-${color}`);
    if (statusEl) {
      const val = selectedDeltas[color];
      if (val > 0) {
        statusEl.innerText = `+${val}`;
        statusEl.className = 'delta-status positive';
      } else if (val < 0) {
        statusEl.innerText = `${val}`;
        statusEl.className = 'delta-status negative';
      } else {
        statusEl.innerText = '0';
        statusEl.className = 'delta-status neutral';
      }
    }
  });
}

function openPlayerPokemonModal(playerId) {
  const player = currentGameState.players.find(p => p.id === playerId);
  if (!player) return;

  document.getElementById('modal-player-title').innerText = `⚡ ${player.name} (${player.character})의 보유 포켓몬`;
  const grid = document.getElementById('modal-card-grid');
  grid.innerHTML = '';

  if (!player.cards || player.cards.length === 0) {
    grid.innerHTML = '<div style="color:#aaa; padding: 30px; font-weight:bold;">보유 중인 포켓몬이 없습니다.</div>';
  } else {
    player.cards.forEach(card => {
      const cardDiv = document.createElement('div');
      cardDiv.className = 'modal-card-item';
      cardDiv.innerHTML = `<img src="${card.image}" alt="${card.name}">`;
      grid.appendChild(cardDiv);
    });
  }
  document.getElementById('pokemon-modal').style.display = 'flex';
}

document.getElementById('modal-close-btn').addEventListener('click', () => {
  document.getElementById('pokemon-modal').style.display = 'none';
});
document.getElementById('pokemon-modal').addEventListener('click', (e) => {
  if (e.target.id === 'pokemon-modal') {
    document.getElementById('pokemon-modal').style.display = 'none';
  }
});

function render() {
  if (!currentGameState) return;

  if (!currentGameState.started) {
    document.getElementById('lobby').style.display = 'flex';
    document.getElementById('game-container').style.display = 'none';

    const players = currentGameState.players;
    document.getElementById('lobby-count').innerText = players.length;

    const lobbyList = document.getElementById('lobby-players-list');
    lobbyList.innerHTML = '';

    if (players.length === 0) {
      lobbyList.innerHTML = '<div class="lobby-empty">입장한 플레이어가 없습니다.</div>';
    } else {
      players.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'lobby-player-item';
        item.innerHTML = `
          <img src="/images/p${idx + 1}.png" class="lobby-player-avatar" alt="p${idx + 1}">
          <div class="lobby-player-info">
            <span class="lobby-player-name">${p.name} ${p.id === mySocketId ? ' (나)' : ''}</span>
            <span class="lobby-player-trainer">캐릭터: ${p.character}</span>
          </div>
        `;
        lobbyList.appendChild(item);
      });
    }

    const isHost = players.length > 0 && players[0].id === mySocketId;
    const btnStart = document.getElementById('btnStart');
    if (isHost && players.length >= 2) {
      btnStart.style.display = 'inline-block';
    } else {
      btnStart.style.display = 'none';
    }

    return;
  }

  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game-container').style.display = 'flex';

  const turnPlayerIdx = currentGameState.currentTurn;
  const turnPlayer = currentGameState.players[turnPlayerIdx];

  if (turnPlayer) {
    document.getElementById('current-turn-player').innerText = `${turnPlayer.name} (${turnPlayer.character})`;
    document.getElementById('current-turn-avatar').src = `/images/p${turnPlayerIdx + 1}.png`;

    // 💡 턴이 바뀔 때 중앙 토스트 팝업과 함께 turn.mp3 효과음 재생
    if (lastTurnPlayerId !== turnPlayer.id) {
      lastTurnPlayerId = turnPlayer.id;
      showTurnToast(`✨ ${turnPlayer.name}님의 턴입니다!`);
      
      // 사운드 재생 (브라우저 정책에 의해 첫 상호작용 이후 정상 재생됨)
      turnSound.currentTime = 0;
      turnSound.play().catch(err => {
        console.log("브라우저 자동재생 정책으로 사운드 재생이 차단될 수 있습니다:", err);
      });
    }
  }

  Object.keys(currentGameState.tokens).forEach(color => {
    const el = document.getElementById(`bank-${color}`);
    if (el) el.innerText = currentGameState.tokens[color];
  });

  const logsContainer = document.getElementById('game-logs');
  if (logsContainer && currentGameState.logs) {
    logsContainer.innerHTML = currentGameState.logs.map(log => `
      <div class="log-item">
        <span class="log-time">[${log.time}]</span>${log.msg}
      </div>
    `).join('');
  }

  const myPlayer = currentGameState.players.find(p => p.id === mySocketId);
  const myReservedCount = myPlayer && myPlayer.reserved ? myPlayer.reserved.length : 0;
  const isReservedFull = myReservedCount >= 3;

  ['level1', 'level2', 'level3'].forEach(lvl => {
    const deckSlot = document.getElementById(`deck-slot-${lvl}`);
    if (!deckSlot) return;

    const deckCount = (currentGameState.decks && currentGameState.decks[lvl]) ? currentGameState.decks[lvl].length : 0;
    const deckImg = DECK_IMAGES[lvl];

    deckSlot.innerHTML = `
      <div class="deck-card">
        <div class="deck-card-inner">
          <img src="${deckImg}" class="deck-pokeball-img" alt="${lvl} deck">
          <div class="deck-count">${deckCount}장</div>
        </div>
        <button class="btn-deck-keep" 
          ${(deckCount === 0 || isReservedFull) ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} 
          onclick="reserveFromDeck('${lvl}')">
          ${deckCount === 0 ? '매진' : (isReservedFull ? '킵 불가' : '덱 킵')}
        </button>
      </div>
    `;
  });

  ['level1', 'level2', 'level3', 'rare', 'legendary'].forEach(lvl => {
    const container = document.getElementById(`cards-${lvl}`);
    if (!container) return;
    container.innerHTML = '';

    currentGameState.market[lvl].forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = `card ${lvl}`;

      const canReserve = (lvl !== 'rare' && lvl !== 'legendary');

      cardEl.innerHTML = `
        <div class="card-top">
          <span class="card-name">${card.name}</span>
        </div>

        <div class="card-img-wrapper">
          <img src="${card.image}" alt="${card.name}" onerror="this.style.display='none'">
        </div>

        <div class="card-actions">
          <button onclick="buyCard('${card.id}', false, false)">포획</button>
          ${card.evolutionFrom ? `<button class="btn-evo" onclick="buyCard('${card.id}', true, false)">진화</button>` : ''}
          ${canReserve ? `
            <button class="btn-keep" 
              ${isReservedFull ? 'disabled style="opacity:0.4; cursor:not-allowed;" title="최대 3장까지만 킵 가능"' : ''} 
              onclick="reserveCard('${card.id}')">
              ${isReservedFull ? '킵 불가' : '킵'}
            </button>
          ` : ''}
        </div>
      `;
      container.appendChild(cardEl);
    });
  });

  const playersList = document.getElementById('players-list');
  playersList.innerHTML = '';

  currentGameState.players.forEach((p, idx) => {
    const pEl = document.createElement('div');
    pEl.className = `player-card ${idx === turnPlayerIdx ? 'active-turn' : ''}`;

    const playerAvatarImg = `/images/p${idx + 1}.png`;
    const cardCount = p.cards.length;
    const isMe = (p.id === mySocketId);

    const pTotalTokens = Object.values(p.tokens).reduce((a, b) => a + b, 0);
    const needsDiscard = isMe && (pTotalTokens > 10);

    let warningHTML = '';
    if (needsDiscard) {
      warningHTML = `<div class="token-warning-banner">⚠️ 보유 토큰 초과 (${pTotalTokens}/10)! 버릴 토큰을 선택하세요.</div>`;
    }

    const ballColors = ['monster', 'super', 'hyper', 'heal', 'quick', 'master'];
    const tokenItemsHTML = ballColors.map(color => {
      const count = p.tokens[color] || 0;
      const discardBtn = (needsDiscard && count > 0 && color !== 'master')
        ? `<button class="btn-discard" onclick="discardToken('${color}')">버리기</button>`
        : '';
      return `<div class="player-token-item"><img src="/images/${color}.png"> ${count}${discardBtn}</div>`;
    }).join('');

    let reservedHTML = '';
    if (p.reserved && p.reserved.length > 0) {
      if (isMe) {
        const reservedItems = p.reserved.map(c => `
          <div class="mini-reserved-card">
            <img src="${c.image}" alt="${c.name}">
            <span>${c.name}</span>
            <div class="mini-card-actions">
              <button onclick="buyCard('${c.id}', false, true)">포획</button>
              ${c.evolutionFrom ? `<button class="btn-evo" onclick="buyCard('${c.id}', true, true)">진화</button>` : ''}
            </div>
          </div>
        `).join('');

        reservedHTML = `
          <div class="player-reserved-section">
            <div class="reserved-title">🔒 내가 킵한 카드 (${p.reserved.length}/3)</div>
            <div class="reserved-list">${reservedItems}</div>
          </div>
        `;
      } else {
        reservedHTML = `
          <div class="player-reserved-section">
            <div class="reserved-title">🔒 킵한 카드: ${p.reserved.length}장 (비공개)</div>
          </div>
        `;
      }
    }

    pEl.innerHTML = `
      ${warningHTML}
      <div class="player-header">
        <img src="${playerAvatarImg}" class="player-avatar" alt="p${idx + 1}">
        <div class="player-info-text">
          <div class="player-name-tag">${p.name} ${isMe ? ' (나)' : ''}</div>
          <div class="player-trainer-tag">트레이너: ${p.character}</div>
        </div>
        
        <div class="player-score-box">
          <div class="player-score">🏆 ${p.points}점</div>
          <div class="player-score-sub">목표: 18점</div>
        </div>
      </div>

      <div class="player-tokens-header">
        <span>볼 토큰</span>
        <span class="player-total-token-badge">총 ${pTotalTokens} / 10개</span>
      </div>

      <div class="player-tokens-row">
        ${tokenItemsHTML}
      </div>

      <button class="btn-view-pokemon" onclick="openPlayerPokemonModal('${p.id}')">
        🔍 보유 포켓몬 이미지로 보기 (${cardCount}장)
      </button>

      ${reservedHTML}
    `;
    playersList.appendChild(pEl);
  });
}

function buyCard(cardId, isEvolution, isReserved) { 
  socket.emit('buyCard', { cardId, isEvolution, isReserved }); 
}
function reserveCard(cardId) { 
  socket.emit('reserveCard', cardId); 
}
function reserveFromDeck(level) {
  socket.emit('reserveFromDeck', level);
}
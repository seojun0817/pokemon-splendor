const socket = io();
let mySocketId = null;
let currentGameState = null;
let lastTurnPlayerId = null;

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
  const nameInput = document.getElementById('playerName');
  const name = nameInput.value.trim();
  if (!name) return alert('이름을 입력해주세요.');
  
  socket.emit('joinRoom', name);
  
  nameInput.disabled = true;
  document.getElementById('btnJoin').disabled = true;
});

document.getElementById('btnStart').addEventListener('click', () => socket.emit('startGame'));

function resetGame() {
  if (confirm('정말로 게임을 처음부터 다시 시작하시겠습니까? (모든 진행 상황이 초기화됩니다)')) {
    socket.emit('resetGame');
  }
}

// 💡 플레이어 인터페이스 내 토큰 수동 조절 함수 (마스터볼 포함)
function adjustPlayerToken(color, delta) {
  socket.emit('adjustPlayerToken', { color, delta });
}

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

function sendChat() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const msg = input.value;
  if (!msg.trim()) return;

  socket.emit('sendChatMessage', msg);
  input.value = '';
}

const btnSendChat = document.getElementById('btnSendChat');
if (btnSendChat) {
  btnSendChat.addEventListener('click', sendChat);
}

const chatInput = document.getElementById('chatInput');
if (chatInput) {
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
  });
}

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

const modalCloseBtn = document.getElementById('modal-close-btn');
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', () => {
    document.getElementById('pokemon-modal').style.display = 'none';
  });
}

const pokemonModal = document.getElementById('pokemon-modal');
if (pokemonModal) {
  pokemonModal.addEventListener('click', (e) => {
    if (e.target.id === 'pokemon-modal') {
      document.getElementById('pokemon-modal').style.display = 'none';
    }
  });
}

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

  const players = currentGameState.players;
  const isHost = players.length > 0 && players[0].id === mySocketId;
  const btnResetGame = document.getElementById('btnResetGame');
  if (btnResetGame) {
    btnResetGame.style.display = isHost ? 'inline-block' : 'none';
  }

  const turnPlayerIdx = currentGameState.currentTurn;
  const turnPlayer = currentGameState.players[turnPlayerIdx];

  if (turnPlayer) {
    document.getElementById('current-turn-player').innerText = `${turnPlayer.name} (${turnPlayer.character})`;
    document.getElementById('current-turn-avatar').src = `/images/p${turnPlayerIdx + 1}.png`;

    if (lastTurnPlayerId !== turnPlayer.id) {
      lastTurnPlayerId = turnPlayer.id;
      showTurnToast(`✨ ${turnPlayer.name}님의 턴입니다!`);
      
      turnSound.currentTime = 0;
      turnSound.play().catch(err => {
        console.log("사운드 재생 차단:", err);
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
    const isMe = (p.id === mySocketId);
    const isMyTurn = (idx === turnPlayerIdx);

    const playerAvatarImg = `/images/p${idx + 1}.png`;
    const cardCount = p.cards.length;

    const pTotalTokens = Object.values(p.tokens).reduce((a, b) => a + b, 0);
    const needsDiscard = isMe && (pTotalTokens > 10);

    let warningHTML = '';
    if (needsDiscard) {
      warningHTML = `<div class="token-warning-banner">⚠️ 보유 토큰 초과 (${pTotalTokens}/10)! 버릴 토큰을 선택하세요.</div>`;
    }

    const ballColors = ['monster', 'super', 'hyper', 'heal', 'quick', 'master'];
    const tokenItemsHTML = ballColors.map(color => {
      const count = p.tokens[color] || 0;
      
      // 💡 내 턴이고 내 카드일 경우, 마스터볼을 포함한 모든 토큰에 수동 조절 (+/-) 버튼 노출
      let manualControl = '';
      if (isMe && isMyTurn) {
        manualControl = `
          <div class="manual-token-btns">
            <button class="btn-token-pm" onclick="adjustPlayerToken('${color}', -1)">-</button>
            <button class="btn-token-pm" onclick="adjustPlayerToken('${color}', 1)">+</button>
          </div>
        `;
      }

      const discardBtn = (needsDiscard && count > 0 && color !== 'master')
        ? `<button class="btn-discard" onclick="discardToken('${color}')">버리기</button>`
        : '';

      return `
        <div class="player-token-item">
          <img src="/images/${color}.png"> 
          <span>${count}</span>
          ${manualControl}
          ${discardBtn}
        </div>
      `;
    }).join('');

    let reservedSideHTML = '';
    if (isMe && p.reserved && p.reserved.length > 0) {
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

      reservedSideHTML = `
        <div class="player-reserved-side-box">
          <div class="reserved-side-title">🔒 킵한 카드 (${p.reserved.length}/3)</div>
          <div class="reserved-side-list">${reservedItems}</div>
        </div>
      `;
    }

    const innerCardHTML = `
      <div class="player-card ${isMyTurn ? 'active-turn' : ''}">
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
      </div>
    `;

    const rowWrapper = document.createElement('div');
    rowWrapper.className = 'player-row-wrapper';
    rowWrapper.innerHTML = innerCardHTML + reservedSideHTML;
    playersList.appendChild(rowWrapper);
  });
}

function buyCard(cardId, isEvolution, isReserved) {
  if (!currentGameState) return;
  const myPlayer = currentGameState.players.find(p => p.id === mySocketId);
  if (!myPlayer) return;

  let targetCard = null;
  if (isReserved) {
    targetCard = myPlayer.reserved.find(c => c.id === cardId);
  } else {
    ['level1', 'level2', 'level3', 'rare', 'legendary'].forEach(lvl => {
      const found = currentGameState.market[lvl].find(c => c.id === cardId);
      if (found) targetCard = found;
    });
  }

  if (!targetCard) return;

  if (!isEvolution) {
    const currentBonus = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };
    myPlayer.cards.forEach(c => {
      const cnt = c.energyCount || 1;
      if (currentBonus[c.energy] !== undefined) currentBonus[c.energy] += cnt;
    });

    const reqCost = targetCard.cost;
    let neededMaster = 0;

    for (const [type, costVal] of Object.entries(reqCost)) {
      const bonusVal = currentBonus[type] || 0;
      const costAfterBonus = Math.max(0, costVal - bonusVal);
      const myTokenVal = myPlayer.tokens[type] || 0;

      if (myTokenVal < costAfterBonus) {
        neededMaster += (costAfterBonus - myTokenVal);
      }
    }

    if (neededMaster > 0) {
      if (myPlayer.tokens.master < neededMaster) {
        return alert(`마스터볼 토큰이 부족하여 포획할 수 없습니다. (필요: ${neededMaster}개, 보유: ${myPlayer.tokens.master}개)`);
      }
      
      const confirmUse = confirm(`일반 토큰이 부족하여 마스터볼 ${neededMaster}개가 소모됩니다. 포획하시겠습니까?`);
      if (!confirmUse) return;
    }
  }

  socket.emit('buyCard', { cardId, isEvolution, isReserved });
}

function reserveCard(cardId) { 
  socket.emit('reserveCard', cardId); 
}
function reserveFromDeck(level) {
  socket.emit('reserveFromDeck', level);
}
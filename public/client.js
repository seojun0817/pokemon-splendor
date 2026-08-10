const socket = io();
let mySocketId = null;
let currentGameState = null;
let selectedTokens = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };

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
  const name = document.getElementById('playerName').value;
  socket.emit('joinRoom', name);
  document.getElementById('playerName').disabled = true;
  document.getElementById('btnJoin').disabled = true;
});

document.getElementById('btnStart').addEventListener('click', () => socket.emit('startGame'));

document.querySelectorAll('.token-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.getAttribute('data-color');
    if (!color) return;

    if (selectedTokens[color] < 2) {
      selectedTokens[color]++;
    } else {
      selectedTokens[color] = 0;
    }
    updateTokenSelectionUI();
  });
});

document.getElementById('btnResetTokens').addEventListener('click', () => {
  selectedTokens = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };
  updateTokenSelectionUI();
});

document.getElementById('btnConfirmTokens').addEventListener('click', () => {
  socket.emit('takeTokens', selectedTokens);
  selectedTokens = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };
  updateTokenSelectionUI();
});

function updateTokenSelectionUI() {
  Object.keys(selectedTokens).forEach(color => {
    const badge = document.getElementById(`select-${color}`);
    if (badge) {
      const count = selectedTokens[color];
      badge.innerText = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  });
}

function render() {
  if (!currentGameState) return;

  // ----------------------------------------------------
  // 1. 💡 게임 시작 전: 대기실 화면 렌더링
  // ----------------------------------------------------
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

    // 방장(첫번째 플레이어)이며 2명 이상일 때만 [게임 시작] 버튼 표시
    const isHost = players.length > 0 && players[0].id === mySocketId;
    const btnStart = document.getElementById('btnStart');
    if (isHost && players.length >= 2) {
      btnStart.style.display = 'inline-block';
    } else {
      btnStart.style.display = 'none';
    }

    return;
  }

  // ----------------------------------------------------
  // 2. 🎮 게임 시작 후: 인게임 대시보드 화면 렌더링
  // ----------------------------------------------------
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game-container').style.display = 'flex';

  const turnPlayerIdx = currentGameState.currentTurn;
  const turnPlayer = currentGameState.players[turnPlayerIdx];

  if (turnPlayer) {
    document.getElementById('current-turn-player').innerText = `${turnPlayer.name} (${turnPlayer.character})`;
    document.getElementById('current-turn-avatar').src = `/images/p${turnPlayerIdx + 1}.png`;
  }

  Object.keys(currentGameState.tokens).forEach(color => {
    const el = document.getElementById(`bank-${color}`);
    if (el) el.innerText = currentGameState.tokens[color];
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
          <button onclick="buyCard('${card.id}', false)">구매</button>
          ${card.evolutionFrom ? `<button class="btn-evo" onclick="buyCard('${card.id}', true)">진화</button>` : ''}
          ${canReserve ? `<button class="btn-keep" onclick="reserveCard('${card.id}')">킵</button>` : ''}
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
    const cardNames = p.cards.map(c => c.name).join(', ') || '없음';

    pEl.innerHTML = `
      <div class="player-header">
        <img src="${playerAvatarImg}" class="player-avatar" alt="p${idx + 1}">
        <div class="player-info-text">
          <div class="player-name-tag">${p.name} ${p.id === mySocketId ? ' (나)' : ''}</div>
          <div class="player-trainer-tag">트레이너: ${p.character}</div>
        </div>
        <div class="player-score">${p.points}점</div>
      </div>

      <div class="player-tokens-row">
        <div class="player-token-item"><img src="/images/monster.png"> ${p.tokens.monster}</div>
        <div class="player-token-item"><img src="/images/super.png"> ${p.tokens.super}</div>
        <div class="player-token-item"><img src="/images/hyper.png"> ${p.tokens.hyper}</div>
        <div class="player-token-item"><img src="/images/heal.png"> ${p.tokens.heal}</div>
        <div class="player-token-item"><img src="/images/quick.png"> ${p.tokens.quick}</div>
        <div class="player-token-item"><img src="/images/master.png"> ${p.tokens.master}</div>
      </div>

      <div class="player-cards-summary">
        <strong>보유 포켓몬:</strong> ${cardNames}
      </div>
    `;
    playersList.appendChild(pEl);
  });
}

function buyCard(cardId, isEvolution) { socket.emit('buyCard', { cardId, isEvolution }); }
function reserveCard(cardId) { socket.emit('reserveCard', cardId); }
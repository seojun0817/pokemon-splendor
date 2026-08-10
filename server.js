const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const INITIAL_CARDS = require('./cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const AVAILABLE_TRAINERS = ['지우', '이슬', '웅', '로켓단'];

const BALL_NAMES_KR = {
  monster: '몬스터볼',
  super: '슈퍼볼',
  hyper: '하이퍼볼',
  heal: '힐볼',
  quick: '퀵볼',
  master: '마스터볼'
};

const LEVEL_NAMES_KR = {
  level1: '1단계',
  level2: '2단계',
  level3: '3단계'
};

let gameState = {
  started: false,
  players: [],
  currentTurn: 0,
  tokens: { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0, master: 5 },
  decks: { level1: [], level2: [], level3: [], rare: [], legendary: [] },
  market: { level1: [], level2: [], level3: [], rare: [], legendary: [] },
  turnActions: { mainActionDone: false, evolvedDone: false },
  logs: []
};

function addLog(msg) {
  const time = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  gameState.logs.unshift({ time, msg });
  if (gameState.logs.length > 50) gameState.logs.pop();
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getBasicTokenCount(playerCount) {
  if (playerCount === 4) return 7;
  if (playerCount === 3) return 5;
  if (playerCount === 2) return 4;
  return 4;
}

function getPlayerEnergyBonus(player) {
  const bonus = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };
  player.cards.forEach(card => {
    const count = card.energyCount || 1;
    if (bonus[card.energy] !== undefined) {
      bonus[card.energy] += count;
    }
  });
  return bonus;
}

function initGame() {
  const playerCount = gameState.players.length;
  const basicCount = getBasicTokenCount(playerCount);

  gameState.tokens = {
    monster: basicCount, super: basicCount, hyper: basicCount,
    heal: basicCount, quick: basicCount, master: 5
  };

  gameState.decks = JSON.parse(JSON.stringify(INITIAL_CARDS));
  gameState.market = { level1: [], level2: [], level3: [], rare: [], legendary: [] };
  gameState.turnActions = { mainActionDone: false, evolvedDone: false };
  gameState.logs = [];

  ['level1', 'level2', 'level3', 'rare', 'legendary'].forEach(lvl => {
    if (gameState.decks[lvl]) {
      shuffle(gameState.decks[lvl]);
    }
  });

  ['level1', 'level2', 'level3'].forEach(lvl => {
    for (let i = 0; i < 4; i++) {
      if (gameState.decks[lvl] && gameState.decks[lvl].length > 0) {
        gameState.market[lvl].push(gameState.decks[lvl].shift());
      }
    }
  });

  ['rare', 'legendary'].forEach(lvl => {
    if (gameState.decks[lvl] && gameState.decks[lvl].length > 0) {
      gameState.market[lvl].push(gameState.decks[lvl].shift());
    }
  });

  addLog('🎮 포켓몬 스플랜더 게임이 시작되었습니다!');
}

function refillMarket(lvl, cardIdx) {
  if (gameState.decks[lvl] && gameState.decks[lvl].length > 0) {
    gameState.market[lvl][cardIdx] = gameState.decks[lvl].shift();
  } else {
    gameState.market[lvl].splice(cardIdx, 1);
  }
}

function nextTurn() {
  if (gameState.players.length === 0) return;
  
  let attempts = 0;
  do {
    gameState.currentTurn = (gameState.currentTurn + 1) % gameState.players.length;
    attempts++;
  } while (gameState.players[gameState.currentTurn].isDisconnected && attempts < gameState.players.length);

  gameState.turnActions = { mainActionDone: false, evolvedDone: false };
  const currentP = gameState.players[gameState.currentTurn];
  if (currentP && !currentP.isDisconnected) {
    addLog(`🔄 ${currentP.name}님의 턴이 시작되었습니다.`);
  }
}

io.on('connection', (socket) => {
  socket.emit('init', { socketId: socket.id, gameState });

  socket.on('joinRoom', (data) => {
    if (gameState.started) return socket.emit('errorMsg', '이미 게임이 시작되었습니다.');
    if (gameState.players.length >= 4) return socket.emit('errorMsg', '방이 가득 찼습니다.');

    let playerName = typeof data === 'object' && data !== null ? data.name : data;
    if (!playerName || typeof playerName !== 'string') {
      playerName = `플레이어 ${gameState.players.length + 1}`;
    }

    const assignedTrainer = AVAILABLE_TRAINERS[gameState.players.length];

    gameState.players.push({
      id: socket.id,
      name: playerName.trim() || `플레이어 ${gameState.players.length + 1}`,
      character: assignedTrainer,
      tokens: { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0, master: 0 },
      cards: [],
      reserved: [],
      points: 0,
      isDisconnected: false
    });

    io.emit('updateGameState', gameState);
  });

  socket.on('startGame', () => {
    if (gameState.players.length < 2) return socket.emit('errorMsg', '최소 2명이 필요합니다.');
    gameState.started = true;
    initGame();
    io.emit('updateGameState', gameState);
  });

  // 💡 방장 권한 게임 리셋 이벤트 처리
  socket.on('resetGame', () => {
    if (gameState.players.length === 0 || gameState.players[0].id !== socket.id) {
      return socket.emit('errorMsg', '방장만 게임을 리셋할 수 있습니다.');
    }

    // 플레이어들의 카드, 점수, 토큰, 킵 목록 초기화
    gameState.players.forEach(p => {
      p.tokens = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0, master: 0 };
      p.cards = [];
      p.reserved = [];
      p.points = 0;
    });

    gameState.currentTurn = 0;
    gameState.started = true;
    initGame();
    addLog('🔄 방장 권한으로 게임이 재시작되었습니다!');
    io.emit('updateGameState', gameState);
  });

  socket.on('takeTokens', (selectedDeltas) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');
    if (gameState.turnActions.mainActionDone) return socket.emit('errorMsg', '이번 턴에 이미 메인 액션을 수행했습니다.');

    const posDeltas = {};
    let totalPos = 0;
    let totalNeg = 0;
    let hasSameTwo = false;
    let sameTwoColor = null;

    const posStrArr = [];
    const negStrArr = [];

    for (const [color, delta] of Object.entries(selectedDeltas)) {
      if (delta > 0) {
        posDeltas[color] = delta;
        totalPos += delta;
        posStrArr.push(`${BALL_NAMES_KR[color]} x${delta}`);
        if (delta === 2) {
          hasSameTwo = true;
          sameTwoColor = color;
        }
        if (delta > 2) return socket.emit('errorMsg', '한 종류의 토큰은 최대 2개까지만 가져올 수 있습니다.');
      } else if (delta < 0) {
        if (color === 'master') return socket.emit('errorMsg', '마스터볼 토큰은 반납/교환할 수 없습니다.');
        if (player.tokens[color] < Math.abs(delta)) return socket.emit('errorMsg', `${BALL_NAMES_KR[color]} 토큰이 부족합니다.`);
        totalNeg += delta;
        negStrArr.push(`${BALL_NAMES_KR[color]} x${Math.abs(delta)}`);
      }
    }

    const negAbs = Math.abs(totalNeg);
    if (negAbs > totalPos) return socket.emit('errorMsg', '반납(-)하는 토큰 수는 가져올(+) 토큰 수를 초과할 수 없습니다.');

    if (totalPos > 0) {
      if (hasSameTwo) {
        if (Object.keys(posDeltas).length > 1 || totalPos !== 2) return socket.emit('errorMsg', '동일한 토큰 2개를 가져올 때는 다른 토큰을 함께 가져올 수 없습니다.');
        if (gameState.tokens[sameTwoColor] < 4) return socket.emit('errorMsg', '은행에 해당 토큰이 4개 이상 있을 때만 2개를 가져올 수 있습니다.');
      } else {
        if (totalPos > 3) return socket.emit('errorMsg', '가져오는 토큰의 총 개수는 최대 3개까지만 가능합니다.');
      }
    } else if (negAbs === 0) {
      return socket.emit('errorMsg', '가져올 토큰이나 반납할 토큰을 선택해 주세요.');
    }

    let currentTotal = Object.values(player.tokens).reduce((a, b) => a + b, 0);
    let netChange = totalPos + totalNeg;

    for (const [color, delta] of Object.entries(selectedDeltas)) {
      if (delta > 0 && gameState.tokens[color] < delta) return socket.emit('errorMsg', `은행에 ${BALL_NAMES_KR[color]} 토큰 수량이 부족합니다.`);
    }

    if (currentTotal + netChange > 10) return socket.emit('errorMsg', '토큰은 최대 10개까지만 보유할 수 있습니다.');
    if (currentTotal === 10 && totalPos > 0 && totalPos !== negAbs) return socket.emit('errorMsg', '토큰 10개 보유 중 교환 시 가져올(+) 수량과 반납할(-) 수량이 동일해야 합니다.');

    Object.keys(selectedDeltas).forEach(color => {
      const delta = selectedDeltas[color];
      player.tokens[color] += delta;
      gameState.tokens[color] -= delta;
    });

    gameState.turnActions.mainActionDone = true;

    if (negAbs > 0 && totalPos > 0) {
      addLog(`🔄 ${player.name}님이 [${negStrArr.join(', ')}] 토큰을 반납하고 [${posStrArr.join(', ')}] 토큰을 교환했습니다.`);
    } else if (totalPos > 0) {
      addLog(`🪙 ${player.name}님이 [${posStrArr.join(', ')}] 토큰을 가져왔습니다.`);
    }

    io.emit('updateGameState', gameState);
  });

  socket.on('buyCard', ({ cardId, isEvolution, isReserved }) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');

    if (isEvolution) {
      if (gameState.turnActions.evolvedDone) return socket.emit('errorMsg', '진화는 한 턴에 한 번만 가능합니다.');
    } else if (gameState.turnActions.mainActionDone) {
      return socket.emit('errorMsg', '이번 턴에 이미 메인 액션을 수행했습니다.');
    }

    let targetCard = null;
    let targetLvl = null;

    if (isReserved) {
      const rIdx = player.reserved.findIndex(c => c.id === cardId);
      if (rIdx !== -1) targetCard = player.reserved[rIdx];
    } else {
      ['level1', 'level2', 'level3', 'rare', 'legendary'].forEach(lvl => {
        const idx = gameState.market[lvl].findIndex(c => c.id === cardId);
        if (idx !== -1) {
          targetCard = gameState.market[lvl][idx];
          targetLvl = lvl;
        }
      });
    }

    if (!targetCard) return socket.emit('errorMsg', '카드를 찾을 수 없습니다.');

    const currentBonus = getPlayerEnergyBonus(player);

    if (isEvolution) {
      const basePokemonIdx = player.cards.findIndex(c => c.name === targetCard.evolutionFrom);
      if (basePokemonIdx === -1) return socket.emit('errorMsg', `'${targetCard.evolutionFrom}' 포켓몬을 먼저 보유하고 있어야 합니다.`);

      let canEvolve = true;
      for (const [ballType, reqAmount] of Object.entries(targetCard.evoCost)) {
        if ((currentBonus[ballType] || 0) < reqAmount) {
          canEvolve = false;
          break;
        }
      }
      if (!canEvolve) return socket.emit('errorMsg', '진화에 필요한 카드 에너지 보너스가 부족합니다.');

      player.cards.splice(basePokemonIdx, 1, targetCard);
      gameState.turnActions.evolvedDone = true;
      addLog(`⚡ ${player.name}님이 [${targetCard.name}] 포켓몬으로 진화시켰습니다! (+${targetCard.points}점)`);

    } else {
      const reqCost = targetCard.cost;
      let neededMaster = 0;
      const paymentTokens = { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0 };

      for (const [type, costVal] of Object.entries(reqCost)) {
        const bonusVal = currentBonus[type] || 0;
        const costAfterBonus = Math.max(0, costVal - bonusVal);
        const myTokenVal = player.tokens[type] || 0;

        if (myTokenVal >= costAfterBonus) {
          paymentTokens[type] = costAfterBonus;
        } else {
          paymentTokens[type] = myTokenVal;
          neededMaster += (costAfterBonus - myTokenVal);
        }
      }

      if (player.tokens.master < neededMaster) {
        return socket.emit('errorMsg', `마스터볼 토큰이 부족하여 포획할 수 없습니다. (필요: ${neededMaster}개, 보유: ${player.tokens.master}개)`);
      }

      for (const [type, payVal] of Object.entries(paymentTokens)) {
        if (payVal > 0) {
          player.tokens[type] -= payVal;
          gameState.tokens[type] += payVal;
        }
      }

      if (neededMaster > 0) {
        player.tokens.master -= neededMaster;
        gameState.tokens.master += neededMaster;
      }

      player.cards.push(targetCard);
      gameState.turnActions.mainActionDone = true;
      addLog(`🐾 ${player.name}님이 [${targetCard.name}] 카드를 포획했습니다! (+${targetCard.points}점)`);
    }

    player.points = player.cards.reduce((sum, c) => sum + c.points, 0);

    if (isReserved) {
      const rIdx = player.reserved.findIndex(c => c.id === cardId);
      player.reserved.splice(rIdx, 1);
    } else {
      refillMarket(targetLvl, gameState.market[targetLvl].findIndex(c => c.id === cardId));
    }

    if (player.points >= 18) {
      addLog(`🏆🎉 ${player.name}님이 최종 승리 조건(18점)을 달성했습니다!`);
      io.emit('gameOver', { winner: player.name, character: player.character, points: player.points });
      return;
    }

    io.emit('updateGameState', gameState);
  });

  socket.on('reserveCard', (cardId) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');
    if (gameState.turnActions.mainActionDone) return socket.emit('errorMsg', '이번 턴에 이미 메인 액션을 수행했습니다.');
    if (player.reserved && player.reserved.length >= 3) return socket.emit('errorMsg', '카드는 최대 3장까지만 킵할 수 있습니다.');

    let targetCard = null;
    let targetLvl = null;

    ['level1', 'level2', 'level3', 'rare', 'legendary'].forEach(lvl => {
      const idx = gameState.market[lvl].findIndex(c => c.id === cardId);
      if (idx !== -1) {
        targetCard = gameState.market[lvl][idx];
        targetLvl = lvl;
      }
    });

    if (!targetCard) return socket.emit('errorMsg', '카드를 찾을 수 없습니다.');
    if (targetLvl === 'rare' || targetLvl === 'legendary') return socket.emit('errorMsg', '전설 및 희귀 카드는 킵할 수 없습니다.');

    player.reserved.push(targetCard);
    let gotMaster = false;
    if (gameState.tokens.master > 0) {
      gameState.tokens.master -= 1;
      player.tokens.master += 1;
      gotMaster = true;
    }

    refillMarket(targetLvl, gameState.market[targetLvl].findIndex(c => c.id === cardId));
    gameState.turnActions.mainActionDone = "true"; // 수정됨
    gameState.turnActions.mainActionDone = true;
    addLog(`🔒 ${player.name}님이 [${targetCard.name}] 카드를 킵했습니다.${gotMaster ? ' (마스터볼 +1)' : ''}`);

    io.emit('updateGameState', gameState);
  });

  socket.on('reserveFromDeck', (lvl) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');
    if (gameState.turnActions.mainActionDone) return socket.emit('errorMsg', '이번 턴에 이미 메인 액션을 수행했습니다.');
    if (player.reserved && player.reserved.length >= 3) return socket.emit('errorMsg', '카드는 최대 3장까지만 킵할 수 있습니다.');
    if (!gameState.decks[lvl] || gameState.decks[lvl].length === 0) return socket.emit('errorMsg', '해당 덱에 남은 카드가 없습니다.');

    const targetCard = gameState.decks[lvl].shift();
    player.reserved.push(targetCard);

    let gotMaster = false;
    if (gameState.tokens.master > 0) {
      gameState.tokens.master -= 1;
      player.tokens.master += 1;
      gotMaster = true;
    }

    gameState.turnActions.mainActionDone = true;
    addLog(`🔒 ${player.name}님이 ${LEVEL_NAMES_KR[lvl]} 덱 맨 위에서 카드를 비밀 킵했습니다.${gotMaster ? ' (마스터볼 +1)' : ''}`);

    io.emit('updateGameState', gameState);
  });

  socket.on('discardToken', (color) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');
    if (color === 'master') return socket.emit('errorMsg', '마스터볼 토큰은 버릴 수 없습니다.');

    const totalTokens = Object.values(player.tokens).reduce((a, b) => a + b, 0);
    if (totalTokens <= 10) return socket.emit('errorMsg', '토큰 수량이 10개 이하이므로 버릴 필요가 없습니다.');
    if (!player.tokens[color] || player.tokens[color] <= 0) return socket.emit('errorMsg', '버릴 토큰이 없습니다.');

    player.tokens[color] -= 1;
    gameState.tokens[color] += 1;
    addLog(`🗑️ ${player.name}님이 [${BALL_NAMES_KR[color]}] 토큰 1개를 버렸습니다.`);

    io.emit('updateGameState', gameState);
  });

  socket.on('endTurn', () => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');

    const totalTokens = Object.values(player.tokens).reduce((a, b) => a + b, 0);
    if (totalTokens > 10) return socket.emit('errorMsg', `보유 토큰이 10개를 초과했습니다 (${totalTokens}/10).`);

    nextTurn();
    io.emit('updateGameState', gameState);
  });

  socket.on('sendChatMessage', (msg) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    const trimmedMsg = msg.trim();
    if (!trimmedMsg) return;

    const time = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });

    io.emit('receiveChatMessage', {
      sender: player.name,
      character: player.character,
      msg: trimmedMsg,
      time: time
    });
  });

  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (gameState.players.length === 0) gameState.started = false;
    io.emit('updateGameState', gameState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`포켓몬 스플랜더 게임 서버 실행 완료: http://localhost:${PORT}`);
});
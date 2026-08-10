const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const INITIAL_CARDS = require('./cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const AVAILABLE_TRAINERS = ['지우', '이슬', '웅', '로켓단'];

let gameState = {
  started: false,
  players: [],
  currentTurn: 0,
  tokens: { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0, master: 5 },
  decks: { level1: [], level2: [], level3: [], rare: [], legendary: [] },
  market: { level1: [], level2: [], level3: [], rare: [], legendary: [] }
};

// 카드 덱 무작위 셔플 함수
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
}

function refillMarket(lvl, cardIdx) {
  if (gameState.decks[lvl] && gameState.decks[lvl].length > 0) {
    gameState.market[lvl][cardIdx] = gameState.decks[lvl].shift();
  } else {
    gameState.market[lvl].splice(cardIdx, 1);
  }
}

function nextTurn() {
  gameState.currentTurn = (gameState.currentTurn + 1) % gameState.players.length;
}

io.on('connection', (socket) => {
  socket.emit('init', { socketId: socket.id, gameState });

  socket.on('joinRoom', (playerName) => {
    if (gameState.started) return socket.emit('errorMsg', '이미 게임이 시작되었습니다.');
    if (gameState.players.length >= 4) return socket.emit('errorMsg', '방이 가득 찼습니다.');

    const assignedTrainer = AVAILABLE_TRAINERS[gameState.players.length];

    gameState.players.push({
      id: socket.id,
      name: playerName || `플레이어 ${gameState.players.length + 1}`,
      character: assignedTrainer,
      tokens: { monster: 0, super: 0, hyper: 0, heal: 0, quick: 0, master: 0 },
      cards: [],
      reserved: [],
      points: 0
    });

    io.emit('updateGameState', gameState);
  });

  socket.on('startGame', () => {
    if (gameState.players.length < 2) return socket.emit('errorMsg', '최소 2명이 필요합니다.');
    gameState.started = true;
    initGame();
    io.emit('updateGameState', gameState);
  });

  socket.on('takeTokens', (selectedTokens) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');

    const currentTotal = Object.values(player.tokens).reduce((a, b) => a + b, 0);
    const takeTotal = Object.values(selectedTokens).reduce((a, b) => a + b, 0);
    if (currentTotal + takeTotal > 10) {
      return socket.emit('errorMsg', '토큰은 최대 10개까지만 가질 수 있습니다.');
    }

    Object.keys(selectedTokens).forEach(color => {
      const count = selectedTokens[color];
      if (count > 0 && gameState.tokens[color] >= count) {
        gameState.tokens[color] -= count;
        player.tokens[color] += count;
      }
    });

    nextTurn();
    io.emit('updateGameState', gameState);
  });

  socket.on('buyCard', ({ cardId, isEvolution }) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');

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

    const currentBonus = getPlayerEnergyBonus(player);

    if (isEvolution) {
      const basePokemonIdx = player.cards.findIndex(c => c.name === targetCard.evolutionFrom);
      if (basePokemonIdx === -1) {
        return socket.emit('errorMsg', `'${targetCard.evolutionFrom}' 포켓몬을 먼저 보유하고 있어야 합니다.`);
      }

      let canEvolve = true;
      for (const [ballType, reqAmount] of Object.entries(targetCard.evoCost)) {
        if ((currentBonus[ballType] || 0) < reqAmount) {
          canEvolve = false;
          break;
        }
      }

      if (!canEvolve) {
        return socket.emit('errorMsg', '진화에 필요한 카드 에너지 보너스가 부족합니다. (진화 시 토큰 지불 불가)');
      }

      player.cards.splice(basePokemonIdx, 1, targetCard);

    } else {
      const reqCost = targetCard.cost;
      let neededMaster = 0;

      Object.keys(reqCost).forEach(type => {
        if (type === 'master') {
          neededMaster += reqCost[type];
        } else {
          const costAfterBonus = Math.max(0, reqCost[type] - (currentBonus[type] || 0));
          if (player.tokens[type] < costAfterBonus) {
            neededMaster += (costAfterBonus - player.tokens[type]);
          }
        }
      });

      if (player.tokens.master < neededMaster) {
        return socket.emit('errorMsg', '토큰(자원)이 부족합니다.');
      }

      Object.keys(reqCost).forEach(type => {
        if (type !== 'master') {
          const costAfterBonus = Math.max(0, reqCost[type] - (currentBonus[type] || 0));
          const payNormal = Math.min(player.tokens[type], costAfterBonus);
          player.tokens[type] -= payNormal;
          gameState.tokens[type] += payNormal;
        }
      });
      player.tokens.master -= neededMaster;
      gameState.tokens.master += neededMaster;

      player.cards.push(targetCard);
    }

    player.points = player.cards.reduce((sum, c) => sum + c.points, 0);

    refillMarket(targetLvl, gameState.market[targetLvl].findIndex(c => c.id === cardId));

    if (player.points >= 18) {
      io.emit('gameOver', { winner: player.name, character: player.character, points: player.points });
      return;
    }

    nextTurn();
    io.emit('updateGameState', gameState);
  });

  // 💡 [수정] 카드 킵(Keep) - 희귀/전설 카드 차단 규칙
  socket.on('reserveCard', (cardId) => {
    const player = gameState.players[gameState.currentTurn];
    if (player.id !== socket.id) return socket.emit('errorMsg', '당신의 턴이 아닙니다.');
    if (player.reserved.length >= 3) return socket.emit('errorMsg', '최대 3장까지만 킵할 수 있습니다.');

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

    // 전설 및 희귀 카드 킵 불가 처리
    if (targetLvl === 'rare' || targetLvl === 'legendary') {
      return socket.emit('errorMsg', '전설 및 희귀 카드는 킵(보관)할 수 없습니다.');
    }

    player.reserved.push(targetCard);
    if (gameState.tokens.master > 0) {
      gameState.tokens.master -= 1;
      player.tokens.master += 1;
    }

    refillMarket(targetLvl, gameState.market[targetLvl].findIndex(c => c.id === cardId));

    nextTurn();
    io.emit('updateGameState', gameState);
  });

  socket.on('disconnect', () => {
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
    if (gameState.players.length === 0) gameState.started = false;
    io.emit('updateGameState', gameState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`포켓몬 스플랜더 게임 서버 실행 완료`);
});
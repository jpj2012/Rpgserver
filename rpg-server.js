const express = require("express");
const http    = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const cors    = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ══════════════════════════════════════════════════════════════════
//  GAME DATA – Classes, Skills, Enemies, Loot
// ══════════════════════════════════════════════════════════════════

const CLASSES = {
  warrior: {
    name: "Krieger", icon: "⚔️",
    baseHp: 120, baseAtk: 14, baseDef: 8, baseMana: 40,
    hpPerLevel: 18, atkPerLevel: 2.5, defPerLevel: 1.8, manaPerLevel: 5,
    skills: {
      berserker: { name: "Berserker",   desc: "Mehr Schaden, weniger Verteidigung",   atkMult: 1.4, defMult: 0.7 },
      paladin:   { name: "Paladin",     desc: "Schaden + Heilung kombiniert",          atkMult: 1.1, healBonus: 0.3 },
      guardian:  { name: "Guardian",    desc: "Maximales Tanken, Aggro-Kontrolle",     defMult: 1.6, hpMult: 1.3  }
    }
  },
  mage: {
    name: "Magier", icon: "🔮",
    baseHp: 60, baseAtk: 22, baseDef: 3, baseMana: 120,
    hpPerLevel: 8, atkPerLevel: 4.5, defPerLevel: 0.8, manaPerLevel: 15,
    skills: {
      pyromancer:  { name: "Pyromancer",  desc: "Feuer-Magie, verbrennt Gegner",        atkMult: 1.5, dotChance: 0.3 },
      cryomancer:  { name: "Cryomancer",  desc: "Eis-Magie, verlangsamt Gegner",        slowChance: 0.4, atkMult: 1.2 },
      arcanist:    { name: "Arcanist",    desc: "Arkane Kraft, ignoriert Rüstung",       armorPen: 0.5, atkMult: 1.3 }
    }
  },
  ranger: {
    name: "Schütze", icon: "🏹",
    baseHp: 80, baseAtk: 16, baseDef: 5, baseMana: 70,
    hpPerLevel: 10, atkPerLevel: 3.2, defPerLevel: 1.2, manaPerLevel: 10,
    skills: {
      hunter:    { name: "Jäger",       desc: "Einzelziel-Fokus, hoher Burst-Schaden", critMult: 1.8, critChance: 0.3 },
      trapper:   { name: "Fallensteller", desc: "Fallen + Slow-Effekte",               trapDmg: 1.3, slowChance: 0.5 },
      sniper:    { name: "Scharfschütze", desc: "Maximale Reichweite, Kopfschüsse",    critMult: 2.5, critChance: 0.2 }
    }
  },
  healer: {
    name: "Heiler", icon: "💚",
    baseHp: 75, baseAtk: 9, baseDef: 5, baseMana: 150,
    hpPerLevel: 10, atkPerLevel: 1.5, defPerLevel: 1.0, manaPerLevel: 20,
    skills: {
      priest:    { name: "Priester",    desc: "Starke Heilung, Segen-Buffs",           healMult: 1.6, buffStrength: 1.3 },
      shaman:    { name: "Schamane",    desc: "Gruppe heilen + Elementar-Schaden",     groupHeal: 0.4, atkMult: 1.2 },
      druid:     { name: "Druide",      desc: "HoT (Heal over Time), Natur-Schaden",   hotStrength: 1.5, atkMult: 1.1 }
    }
  }
};

const ENEMY_TYPES = {
  // Höhle
  goblin:    { name: "Goblin",     icon: "👺", baseHp: 0.6, baseAtk: 0.7, baseDef: 0.3, xp: 12, gold: [2,6]  },
  troll:     { name: "Troll",      icon: "👹", baseHp: 1.8, baseAtk: 1.1, baseDef: 0.8, xp: 28, gold: [5,12] },
  bat:       { name: "Fledermaus", icon: "🦇", baseHp: 0.4, baseAtk: 0.8, baseDef: 0.2, xp: 8,  gold: [1,3]  },
  // Wald
  wolf:      { name: "Wolf",       icon: "🐺", baseHp: 0.7, baseAtk: 0.9, baseDef: 0.3, xp: 14, gold: [3,7]  },
  spider:    { name: "Riesenspin", icon: "🕷", baseHp: 0.5, baseAtk: 1.0, baseDef: 0.2, xp: 10, gold: [2,5]  },
  treant:    { name: "Baumriese",  icon: "🌳", baseHp: 2.2, baseAtk: 0.9, baseDef: 1.0, xp: 32, gold: [6,14] },
  // Gruft
  skeleton:  { name: "Skelett",   icon: "💀", baseHp: 0.7, baseAtk: 0.8, baseDef: 0.4, xp: 16, gold: [4,8]  },
  zombie:    { name: "Zombie",     icon: "🧟", baseHp: 1.2, baseAtk: 0.6, baseDef: 0.5, xp: 20, gold: [4,9]  },
  wraith:    { name: "Geist",      icon: "👻", baseHp: 0.6, baseAtk: 1.3, baseDef: 0.1, xp: 22, gold: [5,10] },
  // Vulkan
  imp:       { name: "Imp",        icon: "😈", baseHp: 0.5, baseAtk: 1.1, baseDef: 0.2, xp: 14, gold: [3,7]  },
  golem:     { name: "Golem",      icon: "🗿", baseHp: 2.5, baseAtk: 1.2, baseDef: 1.4, xp: 38, gold: [8,18] },
  // Bosse
  dragonling:{ name: "Drachling",  icon: "🐉", baseHp: 5.0, baseAtk: 2.0, baseDef: 1.5, xp: 120, gold: [25,60], isBoss: true },
  lich:      { name: "Lich",       icon: "🧙", baseHp: 4.0, baseAtk: 2.5, baseDef: 0.8, xp: 140, gold: [30,70], isBoss: true },
  demon:     { name: "Dämon",      icon: "👿", baseHp: 4.5, baseAtk: 2.2, baseDef: 1.2, xp: 130, gold: [28,65], isBoss: true },
};

const BIOMES = {
  cave:    { name: "Höhle",    icon: "🏔", enemies: ["goblin","troll","bat"],       boss: "dragonling", roomCount:[8,12], color:"#1a1a2e" },
  forest:  { name: "Wald",     icon: "🌲", enemies: ["wolf","spider","treant"],     boss: "lich",       roomCount:[9,13], color:"#0d2818" },
  crypt:   { name: "Gruft",    icon: "⚰️", enemies: ["skeleton","zombie","wraith"], boss: "lich",       roomCount:[8,11], color:"#1a0a2e" },
  volcano: { name: "Vulkan",   icon: "🌋", enemies: ["imp","golem","imp"],          boss: "demon",      roomCount:[7,10], color:"#2e0a00" }
};

const ITEM_BASES = {
  weapon:  ["Schwert","Stab","Bogen","Kelch","Axt","Dolch","Hammer","Zauberstab"],
  helmet:  ["Helm","Kapuze","Krone","Haube"],
  armor:   ["Rüstung","Robe","Lederrüstung","Kettenhemd"],
  boots:   ["Stiefel","Sandalen","Schuhe","Greaves"],
  ring:    ["Ring","Siegelring","Bandring","Gemmenring"],
  amulet:  ["Amulett","Talisman","Anhänger","Medallion"],
};

const ITEM_PREFIXES = ["Alte","Mystische","Vergoldete","Dunkle","Heilige","Verzauberte","Uralte","Verfluchte","Legendäre","Ewige"];
const RARITY = ["common","uncommon","rare","epic","legendary"];
const RARITY_WEIGHTS = [50, 30, 15, 4, 1];
const RARITY_COLORS  = { common:"#aaa", uncommon:"#4a4", rare:"#44f", epic:"#a4f", legendary:"#fa4" };
const RARITY_NAMES   = { common:"Gewöhnlich", uncommon:"Ungewöhnlich", rare:"Selten", epic:"Episch", legendary:"Legendär" };

// ══════════════════════════════════════════════════════════════════
//  UTILITY
// ══════════════════════════════════════════════════════════════════

function seededRng(seed) {
  let s = seed;
  return () => { s=(s*1664525+1013904223)&0xffffffff; return (s>>>0)/0xffffffff; };
}

function randInt(rng, min, max) { return Math.floor(rng()*(max-min+1))+min; }
function randFrom(rng, arr)      { return arr[Math.floor(rng()*arr.length)]; }

function weightedRandom(rng, weights) {
  const total = weights.reduce((a,b)=>a+b,0);
  let r = rng()*total;
  for (let i=0; i<weights.length; i++) { r-=weights[i]; if(r<=0) return i; }
  return weights.length-1;
}

function xpToLevel(xp) {
  // Level = floor(1 + sqrt(xp/50))
  return Math.max(1, Math.floor(1+Math.sqrt(xp/50)));
}

function levelToXpRequired(level) {
  return Math.pow(level, 2) * 50;
}

function getCharStats(char) {
  const cls  = CLASSES[char.class];
  const lvl  = xpToLevel(char.xp);
  const build = char.build ? cls.skills[char.build] : {};

  let hp   = cls.baseHp  + (lvl-1)*cls.hpPerLevel;
  let atk  = cls.baseAtk + (lvl-1)*cls.atkPerLevel;
  let def  = cls.baseDef + (lvl-1)*cls.defPerLevel;
  let mana = cls.baseMana+ (lvl-1)*cls.manaPerLevel;

  // Build modifiers
  if (build.hpMult)  hp   *= build.hpMult;
  if (build.atkMult) atk  *= build.atkMult;
  if (build.defMult) def  *= build.defMult;

  // Equipment bonus
  const items = char.equipment || {};
  Object.values(items).forEach(item => {
    if (!item) return;
    const upg = item.upgrade || 0;
    atk  += (item.bonusAtk  || 0) * (1 + upg*0.15);
    def  += (item.bonusDef  || 0) * (1 + upg*0.15);
    hp   += (item.bonusHp   || 0) * (1 + upg*0.15);
    mana += (item.bonusMana || 0) * (1 + upg*0.15);
  });

  return { hp: Math.round(hp), atk: Math.round(atk), def: Math.round(def), mana: Math.round(mana), level: lvl };
}

function scaleEnemy(enemyType, avgLevel, playerCount) {
  const base = ENEMY_TYPES[enemyType];
  const scale = 8 + avgLevel * 6; // base power
  const groupBonus = 1 + (playerCount-1)*0.3;

  return {
    type: enemyType,
    name: base.name,
    icon: base.icon,
    maxHp: Math.round(base.baseHp * scale * groupBonus),
    hp:    Math.round(base.baseHp * scale * groupBonus),
    atk:   Math.round(base.baseAtk * (4 + avgLevel * 3.5) * groupBonus),
    def:   Math.round(base.baseDef * (2 + avgLevel * 1.5)),
    xpReward:   Math.round(base.xp * (1 + avgLevel*0.2)),
    goldReward: randInt(()=>Math.random(), base.gold[0]*avgLevel, base.gold[1]*avgLevel),
    isBoss: base.isBoss || false,
  };
}

function rollLoot(avgLevel, biome, isBoss, rng) {
  if (!isBoss && rng() > 0.35) return null; // 35% drop chance for normal enemies

  const rarityIdx  = weightedRandom(rng, isBoss
    ? [10, 25, 35, 25, 5]   // boss: better loot
    : RARITY_WEIGHTS
  );
  const rarity = RARITY[rarityIdx];
  const slots  = Object.keys(ITEM_BASES);
  const slot   = randFrom(rng, slots);
  const baseName = randFrom(rng, ITEM_BASES[slot]);
  const prefix   = randFrom(rng, ITEM_PREFIXES);

  const power = avgLevel * (1 + rarityIdx*0.4) * (0.8+rng()*0.4);

  const item = {
    id:      `item_${Date.now()}_${Math.floor(rng()*9999)}`,
    name:    `${prefix} ${baseName}`,
    slot,
    rarity,
    upgrade: 0,
    bonusAtk:  slot==="weapon" ? Math.round(power*1.5) : Math.round(power*0.3),
    bonusDef:  ["armor","helmet","boots"].includes(slot) ? Math.round(power*1.2) : Math.round(power*0.2),
    bonusHp:   Math.round(power*2*(0.5+rng()*0.5)),
    bonusMana: Math.round(power*(0.3+rng()*0.4)),
    value:     Math.round(10 * Math.pow(3, rarityIdx) * (1+avgLevel*0.1)),
  };

  return item;
}

// ══════════════════════════════════════════════════════════════════
//  DUNGEON GENERATION
// ══════════════════════════════════════════════════════════════════

function generateDungeon(seed, avgLevel, playerCount) {
  const rng   = seededRng(seed);
  const biomeKey = randFrom(rng, Object.keys(BIOMES));
  const biome    = BIOMES[biomeKey];
  const roomCount = randInt(rng, biome.roomCount[0], biome.roomCount[1]);

  const rooms = [];

  for (let i=0; i<roomCount; i++) {
    const isElite = !rooms.find(r=>r.isElite) && rng()<0.2 && i>1;
    const isBoss  = i===roomCount-1;
    const isShop  = !isBoss && !isElite && i>0 && rng()<0.15;
    const isTreasure = !isBoss && !isElite && !isShop && i>0 && rng()<0.15;

    let enemies = [];
    if (!isShop && !isTreasure) {
      const enemyCount = isBoss ? 1 : isElite ? 2 : randInt(rng, 1, 4);
      for (let e=0; e<enemyCount; e++) {
        const type = isBoss ? biome.boss : randFrom(rng, biome.enemies);
        const enemy = scaleEnemy(type, avgLevel + (isElite?2:0), playerCount);
        enemy.id = `e_${i}_${e}`;
        enemy.currentHp = enemy.hp;
        enemies.push(enemy);
      }
    }

    // Chest loot
    let chestLoot = null;
    if (isTreasure || (isBoss && rng()<0.8) || (isElite && rng()<0.5)) {
      chestLoot = rollLoot(avgLevel + (isBoss?3:isElite?1:0), biomeKey, isBoss, rng);
    }

    rooms.push({
      id:          i,
      type:        isBoss?"boss":isElite?"elite":isShop?"shop":isTreasure?"treasure":"normal",
      isBoss, isElite, isShop, isTreasure,
      enemies,
      chestLoot,
      cleared:     enemies.length===0,
      connections: i>0 ? [i-1] : [],
      width:       randInt(rng, 8, 16),
      height:      randInt(rng, 6, 12),
    });
    if (i>0) rooms[i-1].connections.push(i);
  }

  return {
    seed, biome: biomeKey, biomeName: biome.name, biomeIcon: biome.icon,
    avgLevel, playerCount, roomCount,
    rooms,
    currentRoom: 0,
    completed: false,
    createdAt: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════════
//  COMBAT ENGINE
// ══════════════════════════════════════════════════════════════════

function calcDamage(attackerAtk, defenderDef, build) {
  const base = Math.max(1, attackerAtk - defenderDef * 0.6);
  const crit = build?.critChance && Math.random() < build.critChance;
  const critMult = crit ? (build.critMult || 1.5) : 1;
  const variance = 0.85 + Math.random()*0.3;
  return { damage: Math.round(base * critMult * variance), crit };
}

// ══════════════════════════════════════════════════════════════════
//  LOBBY / ROOM SYSTEM
// ══════════════════════════════════════════════════════════════════

const sessions  = new Map(); // sessionCode → { players, dungeon, state }
const clients   = new Map(); // ws → { playerId, charId, sessionCode, charData }

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode() {
  let code;
  do { code = Array.from({length:5},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join(""); }
  while (sessions.has(code));
  return code;
}

function broadcast(sessionCode, msg, excludeWs=null) {
  const session = sessions.get(sessionCode);
  if (!session) return;
  const str = JSON.stringify(msg);
  session.players.forEach(({ws})=>{ if(ws!==excludeWs && ws.readyState===WebSocket.OPEN) ws.send(str); });
}

function broadcastAll(sessionCode, msg) { broadcast(sessionCode, msg, null); }

function getSession(sessionCode) { return sessions.get(sessionCode); }

function getAvgLevel(session) {
  if (!session.players.length) return 1;
  const total = session.players.reduce((s,p)=>s+xpToLevel(p.char?.xp||0),0);
  return Math.max(1, Math.round(total/session.players.length));
}

// ══════════════════════════════════════════════════════════════════
//  WEBSOCKET HANDLER
// ══════════════════════════════════════════════════════════════════

wss.on("connection", ws => {
  clients.set(ws, { playerId: null, charId: null, sessionCode: null, char: null });

  ws.on("message", async raw => {
    let msg; try { msg=JSON.parse(raw); } catch { return; }
    const client = clients.get(ws);

    try {
    switch(msg.type) {

      // ── Auth / Character ───────────────────────────────────────
      case "login": {
        // Load or create player
        let player = null;
        try {
          const { data } = await supabase.from("rpg_players")
            .select("*").eq("id", msg.playerId).single();
          player = data;
        } catch(e) { player = null; }

        if (!player) {
          try {
            const { data: newPlayer } = await supabase.from("rpg_players")
              .insert({ id: msg.playerId, name: msg.name || "Abenteurer", gold: 100, created_at: new Date().toISOString() })
              .select().single();
            player = newPlayer;
          } catch(e) {
            console.error("[LOGIN] Fehler beim Erstellen:", e.message);
          }
        }

        // Load characters
        let chars = [];
        try {
          const { data } = await supabase.from("rpg_characters")
            .select("*").eq("player_id", msg.playerId);
          chars = data || [];
        } catch(e) { chars = []; }

        client.playerId = msg.playerId;
        ws.send(JSON.stringify({ type:"login_ok", player: player||{id:msg.playerId,name:msg.name,gold:100}, characters: chars }));
        break;
      }

      case "create_char": {
        if (!CLASSES[msg.class]) return;
        const newChar = {
          player_id:  client.playerId,
          name:       (msg.name||"Held").slice(0,20),
          class:      msg.class,
          xp:         0,
          build:      null,
          equipment:  {},
          inventory:  [],
          dungeons_cleared: 0,
          created_at: new Date().toISOString()
        };
        const { data: char, error } = await supabase.from("rpg_characters").insert(newChar).select().single();
        if (error) { ws.send(JSON.stringify({type:"error",msg:error.message})); break; }
        ws.send(JSON.stringify({ type:"char_created", character: char }));
        break;
      }

      case "select_char": {
        const { data: char } = await supabase.from("rpg_characters")
          .select("*").eq("id", msg.charId).eq("player_id", client.playerId).single();
        if (!char) break;
        client.charId = char.id;
        client.char   = char;
        const stats = getCharStats(char);
        ws.send(JSON.stringify({ type:"char_selected", character: char, stats }));
        break;
      }

      case "set_build": {
        if (!client.charId) break;
        const cls = CLASSES[client.char?.class];
        if (!cls?.skills[msg.build]) break;
        await supabase.from("rpg_characters").update({ build: msg.build }).eq("id", client.charId);
        client.char.build = msg.build;
        ws.send(JSON.stringify({ type:"build_set", build: msg.build }));
        break;
      }

      case "equip_item": {
        if (!client.charId || !client.char) break;
        const inv  = client.char.inventory || [];
        const idx  = inv.findIndex(i=>i.id===msg.itemId);
        if (idx===-1) break;
        const item = inv[idx];
        const equip = { ...(client.char.equipment||{}) };
        // Swap: put old equipped item back to inventory if exists
        if (equip[item.slot]) inv.push(equip[item.slot]);
        equip[item.slot] = item;
        inv.splice(idx, 1);
        await supabase.from("rpg_characters").update({ equipment: equip, inventory: inv }).eq("id", client.charId);
        client.char.equipment = equip;
        client.char.inventory = inv;
        ws.send(JSON.stringify({ type:"char_updated", character: client.char, stats: getCharStats(client.char) }));
        break;
      }

      case "upgrade_item": {
        if (!client.charId || !client.char) break;
        const equip = client.char.equipment || {};
        const item  = equip[msg.slot];
        if (!item || item.upgrade>=5) break;
        const cost  = Math.round(item.value * (1+item.upgrade) * 0.5);
        // Check gold
        const { data: player } = await supabase.from("rpg_players").select("gold").eq("id",client.playerId).single();
        if (!player || player.gold < cost) { ws.send(JSON.stringify({type:"error",msg:"Nicht genug Gold"})); break; }
        item.upgrade++;
        await supabase.from("rpg_players").update({ gold: player.gold-cost }).eq("id",client.playerId);
        await supabase.from("rpg_characters").update({ equipment: equip }).eq("id",client.charId);
        client.char.equipment = equip;
        ws.send(JSON.stringify({ type:"item_upgraded", slot: msg.slot, item, goldSpent: cost, newGold: player.gold-cost }));
        break;
      }

      // ── Dungeon Lobby ──────────────────────────────────────────
      case "create_session": {
        if (!client.char) { ws.send(JSON.stringify({type:"error",msg:"Kein Charakter ausgewählt"})); break; }
        const code = genCode();
        const session = {
          code,
          host: client.playerId,
          players: [{ ws, playerId: client.playerId, char: client.char }],
          dungeon: null,
          state:   "lobby",  // lobby | dungeon | completed
          combatTurn: null,
        };
        sessions.set(code, session);
        client.sessionCode = code;
        ws.send(JSON.stringify({
          type: "session_created", code,
          players: session.players.map(p=>({
            id: p.playerId, name: p.char.name,
            class: p.char.class, stats: getCharStats(p.char)
          }))
        }));
        console.log(`[SESSION] Erstellt: ${code}`);
        break;
      }

      case "join_session": {
        if (!client.char) { ws.send(JSON.stringify({type:"error",msg:"Kein Charakter ausgewählt"})); break; }
        const code = msg.code?.toUpperCase().trim();
        const session = sessions.get(code);
        if (!session) { ws.send(JSON.stringify({type:"error",msg:"Session nicht gefunden"})); break; }
        if (session.state !== "lobby") { ws.send(JSON.stringify({type:"error",msg:"Dungeon bereits gestartet"})); break; }
        if (session.players.length >= 4) { ws.send(JSON.stringify({type:"error",msg:"Gruppe voll (max 4)"})); break; }

        session.players.push({ ws, playerId: client.playerId, char: client.char });
        client.sessionCode = code;

        const playerList = session.players.map(p=>({
          id: p.playerId, name: p.char.name, class: p.char.class, stats: getCharStats(p.char)
        }));

        broadcastAll(code, { type:"player_joined", players: playerList });
        break;
      }

      case "leave_session": {
        removeFromSession(ws, client);
        break;
      }

      case "start_dungeon": {
        const session = sessions.get(client.sessionCode);
        if (!session || session.host!==client.playerId) break;
        if (session.state!=="lobby") break;

        const avgLvl = getAvgLevel(session);
        const seed   = Date.now() % 999999;
        session.dungeon = generateDungeon(seed, avgLvl, session.players.length);
        session.state   = "dungeon";

        // Init HP for all players in this session
        session.players.forEach(p => {
          const stats = getCharStats(p.char);
          p.currentHp   = stats.hp;
          p.maxHp       = stats.hp;
          p.currentMana = stats.mana;
          p.maxMana     = stats.mana;
        });

        broadcastAll(client.sessionCode, {
          type: "dungeon_started",
          dungeon: session.dungeon,
          playerStates: session.players.map(p=>({
            id: p.playerId, name: p.char.name, class: p.char.class,
            build: p.char.build,
            hp: p.currentHp, maxHp: p.maxHp,
            mana: p.currentMana, maxMana: p.maxMana,
            stats: getCharStats(p.char)
          }))
        });
        console.log(`[DUNGEON] Gestartet in ${client.sessionCode}: Biom ${session.dungeon.biomeName}, Level ${avgLvl}`);
        break;
      }

      case "move_room": {
        const session = sessions.get(client.sessionCode);
        if (!session?.dungeon) break;
        const dungeon = session.dungeon;
        const targetRoom = dungeon.rooms[msg.roomId];
        if (!targetRoom) break;
        // Check connection
        const curRoom = dungeon.rooms[dungeon.currentRoom];
        if (!curRoom.connections.includes(msg.roomId)) break;
        // Check current room cleared
        if (!curRoom.cleared) { ws.send(JSON.stringify({type:"error",msg:"Raum nicht besiegt!"})); break; }

        dungeon.currentRoom = msg.roomId;
        broadcastAll(client.sessionCode, { type:"room_changed", roomId: msg.roomId, room: targetRoom });
        break;
      }

      case "attack": {
        const session = sessions.get(client.sessionCode);
        if (!session?.dungeon) break;
        const dungeon  = session.dungeon;
        const room     = dungeon.rooms[dungeon.currentRoom];
        if (room.cleared || room.isShop || room.isTreasure) break;

        const attacker = session.players.find(p=>p.playerId===client.playerId);
        if (!attacker || attacker.currentHp<=0) break;

        // Find target enemy
        const enemy = room.enemies.find(e=>e.id===msg.targetId && e.currentHp>0);
        if (!enemy) break;

        const stats = getCharStats(attacker.char);
        const build = attacker.char.build ? CLASSES[attacker.char.class].skills[attacker.char.build] : {};
        const { damage, crit } = calcDamage(stats.atk, enemy.def, build);

        enemy.currentHp = Math.max(0, enemy.currentHp-damage);

        const events = [{ type:"player_attack", playerId: client.playerId, enemyId: enemy.id, damage, crit, enemyHp: enemy.currentHp }];

        // Enemy dies?
        if (enemy.currentHp<=0) {
          events.push({ type:"enemy_died", enemyId: enemy.id });

          // Give XP + Gold to all
          for (const p of session.players) {
            p.char.xp   = (p.char.xp||0)   + enemy.xpReward;
            const goldEarned = Math.round(enemy.goldReward/session.players.length);
            events.push({ type:"rewards", playerId: p.playerId, xp: enemy.xpReward, gold: goldEarned });

            // Check level up
            const oldLvl = xpToLevel(p.char.xp - enemy.xpReward);
            const newLvl = xpToLevel(p.char.xp);
            if (newLvl > oldLvl) {
              events.push({ type:"level_up", playerId: p.playerId, level: newLvl });
            }

            // Save XP
            await supabase.from("rpg_characters").update({ xp: p.char.xp }).eq("id", p.char.id);
            try {
              const { data: gdata } = await supabase.from("rpg_players").select("gold").eq("id",p.playerId).single();
              if (gdata) await supabase.from("rpg_players").update({ gold:(gdata.gold||0)+goldEarned }).eq("id",p.playerId);
            } catch(e) { console.error("[GOLD]", e.message); }

            // Loot drop?
            const drop = rollLoot(dungeon.avgLevel, dungeon.biome, enemy.isBoss, ()=>Math.random());
            if (drop) {
              p.char.inventory = [...(p.char.inventory||[]), drop];
              await supabase.from("rpg_characters").update({ inventory: p.char.inventory }).eq("id", p.char.id);
              events.push({ type:"item_drop", playerId: p.playerId, item: drop });
            }
          }

          // Check room cleared
          if (room.enemies.every(e=>e.currentHp<=0)) {
            room.cleared = true;
            events.push({ type:"room_cleared", roomId: dungeon.currentRoom, chestLoot: room.chestLoot });

            // Dungeon completed?
            if (room.isBoss) {
              dungeon.completed = true;
              session.state = "completed";
              for (const p of session.players) {
                p.char.dungeons_cleared = (p.char.dungeons_cleared||0)+1;
                await supabase.from("rpg_characters").update({ dungeons_cleared: p.char.dungeons_cleared }).eq("id",p.char.id);
              }
              events.push({ type:"dungeon_completed", dungeonsBiome: dungeon.biomeName });
            }
          }
        } else {
          // Enemy counterattacks the attacker
          const { damage: eDmg } = calcDamage(enemy.atk, stats.def, {});
          attacker.currentHp = Math.max(0, attacker.currentHp - eDmg);
          events.push({ type:"enemy_attack", enemyId: enemy.id, playerId: client.playerId, damage: eDmg, hp: attacker.currentHp });

          if (attacker.currentHp <= 0) {
            events.push({ type:"player_died", playerId: client.playerId });
            // All dead?
            const allDead = session.players.every(p=>p.currentHp<=0);
            if (allDead) {
              events.push({ type:"dungeon_failed" });
              session.state = "completed";
            }
          }
        }

        broadcastAll(client.sessionCode, { type:"combat_events", events });
        break;
      }

      case "take_chest": {
        const session = sessions.get(client.sessionCode);
        if (!session?.dungeon) break;
        const room = session.dungeon.rooms[session.dungeon.currentRoom];
        if (!room.chestLoot || room.chestTaken) break;
        room.chestTaken = true;
        const taker = session.players.find(p=>p.playerId===client.playerId);
        if (!taker) break;
        taker.char.inventory = [...(taker.char.inventory||[]), room.chestLoot];
        await supabase.from("rpg_characters").update({ inventory: taker.char.inventory }).eq("id", taker.char.id);
        broadcastAll(client.sessionCode, { type:"chest_taken", playerId: client.playerId, item: room.chestLoot });
        break;
      }

      case "rest": {
        // Heal between rooms (costs mana)
        const session = sessions.get(client.sessionCode);
        if (!session?.dungeon) break;
        const room = session.dungeon.rooms[session.dungeon.currentRoom];
        if (!room.cleared) break;
        const p = session.players.find(p=>p.playerId===client.playerId);
        if (!p) break;
        const healAmt = Math.round(p.maxHp * 0.25);
        p.currentHp = Math.min(p.maxHp, p.currentHp + healAmt);
        broadcastAll(client.sessionCode, { type:"player_healed", playerId: client.playerId, hp: p.currentHp, amount: healAmt });
        break;
      }

      case "ping": ws.send(JSON.stringify({type:"pong",t:msg.t})); break;
    }
    } catch(err) {
      console.error("[WS ERROR] Unhandled:", err.message, err.stack);
      try { ws.send(JSON.stringify({type:"error", msg:"Server-Fehler: " + err.message})); } catch(_) {}
    }
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    if (client) removeFromSession(ws, client);
    clients.delete(ws);
  });
});

function removeFromSession(ws, client) {
  const code = client.sessionCode;
  if (!code) return;
  const session = sessions.get(code);
  if (!session) return;
  session.players = session.players.filter(p=>p.ws!==ws);
  if (session.players.length===0) {
    sessions.delete(code);
    console.log(`[SESSION] ${code} gelöscht (leer)`);
  } else {
    if (session.host===client.playerId) session.host = session.players[0].playerId;
    broadcast(code, { type:"player_left", playerId: client.playerId });
  }
  client.sessionCode = null;
}

// ══════════════════════════════════════════════════════════════════
//  REST
// ══════════════════════════════════════════════════════════════════

app.get("/", (req,res) => res.json({
  status:"ok", sessions: sessions.size, clients: clients.size
}));

app.get("/classes", (req,res) => res.json(CLASSES));

app.get("/leaderboard", async (req,res) => {
  const { data } = await supabase.from("rpg_characters")
    .select("name,class,xp,dungeons_cleared")
    .order("xp", { ascending:false }).limit(20);
  res.json(data||[]);
});

// ══════════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`RPG Server läuft auf Port ${PORT}`));

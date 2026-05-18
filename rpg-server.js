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

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ══════════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════════

async function verifyToken(token) {
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: "Bearer " + token }
    });
    const u = await r.json();
    if (u.id) return { id: u.id, name: u.user_metadata?.name || "Held" };
    return null;
  } catch(e) { return null; }
}

// ══════════════════════════════════════════════════════════════════
//  GAME DATA
// ══════════════════════════════════════════════════════════════════

const CLASSES = {
  warrior: { name:"Krieger", icon:"⚔️",  baseHp:130, baseAtk:16, baseDef:10, baseMana:40,  hpPerLevel:20, atkPerLevel:3,   defPerLevel:2,   manaPerLevel:5  },
  mage:    { name:"Magier",  icon:"🔮",  baseHp:65,  baseAtk:24, baseDef:4,  baseMana:130, hpPerLevel:9,  atkPerLevel:5,   defPerLevel:0.8, manaPerLevel:18 },
  ranger:  { name:"Schütze", icon:"🏹",  baseHp:90,  baseAtk:18, baseDef:6,  baseMana:80,  hpPerLevel:12, atkPerLevel:3.5, defPerLevel:1.2, manaPerLevel:12 },
  healer:  { name:"Heiler",  icon:"💚",  baseHp:80,  baseAtk:10, baseDef:6,  baseMana:160, hpPerLevel:11, atkPerLevel:1.8, defPerLevel:1.2, manaPerLevel:22 },
};

const CLASS_SKILLS = {
  warrior: [
    { id:"heavy_strike",  name:"Mächtiger Schlag", icon:"⚔️", ap:2, desc:"2x Schaden, -2 Parade",         cooldown:2, needsTarget:"enemy" },
    { id:"shield_bash",   name:"Schildstoß",       icon:"🛡", ap:1, desc:"Schaden + Betäubt 1 Runde",     cooldown:3, needsTarget:"enemy" },
    { id:"war_cry",       name:"Kriegsschrei",     icon:"📣", ap:1, desc:"+3 ATK alle Helden (3 Runden)",  cooldown:4, needsTarget:"none"  },
    { id:"defend",        name:"Verteidigen",      icon:"🏰", ap:1, desc:"+5 Rüstung bis nächste Runde",   cooldown:0, needsTarget:"none"  },
  ],
  mage: [
    { id:"fireball",      name:"Feuerball",        icon:"🔥", ap:2, desc:"Trifft ALLE Gegner",             cooldown:3, needsTarget:"none"  },
    { id:"magic_missile", name:"Magiegeschoss",    icon:"✨", ap:1, desc:"Ignoriert Rüstung",              cooldown:0, needsTarget:"enemy" },
    { id:"arcane_shield", name:"Arkanschild",      icon:"🔮", ap:1, desc:"+6 Rüstung für 2 Runden",       cooldown:3, needsTarget:"none"  },
    { id:"mana_burst",    name:"Manaausbruch",     icon:"💥", ap:2, desc:"Massiver Schaden, -15% eigene HP",cooldown:4, needsTarget:"enemy" },
  ],
  ranger: [
    { id:"aimed_shot",    name:"Zielschuss",       icon:"🎯", ap:2, desc:"Auto-Kritisch",                  cooldown:2, needsTarget:"enemy" },
    { id:"multi_shot",    name:"Feuerstoß",        icon:"🏹", ap:2, desc:"Greift bis zu 3 Gegner an",      cooldown:3, needsTarget:"none"  },
    { id:"set_trap",      name:"Falle stellen",    icon:"🪤", ap:1, desc:"Nächster Angreifer nimmt 2x",    cooldown:3, needsTarget:"none"  },
    { id:"evade",         name:"Ausweichen",       icon:"💨", ap:1, desc:"+8 Parade für 1 Runde",          cooldown:2, needsTarget:"none"  },
  ],
  healer: [
    { id:"heal",          name:"Heilen",           icon:"💚", ap:1, desc:"Starke Heilung an Ziel",          cooldown:0, needsTarget:"ally"  },
    { id:"group_heal",    name:"Gruppensegen",     icon:"✨", ap:2, desc:"Heilt alle Helden",               cooldown:3, needsTarget:"none"  },
    { id:"holy_light",    name:"Heiliges Licht",   icon:"☀️", ap:1, desc:"Schaden, ignoriert Rüstung",     cooldown:1, needsTarget:"enemy" },
    { id:"revive",        name:"Wiederbeleben",    icon:"🌟", ap:2, desc:"Belebt gefallenen Helden (30%)",  cooldown:5, needsTarget:"ally"  },
  ],
};

const ENEMY_TYPES = {
  goblin:    { name:"Goblin",     icon:"👺", hp:0.6, atk:0.7, def:0.3, xp:12,  gold:[2,6],   ini:8,  isBoss:false },
  troll:     { name:"Troll",      icon:"👹", hp:1.9, atk:1.1, def:0.9, xp:30,  gold:[6,14],  ini:4,  isBoss:false },
  bat:       { name:"Fledermaus", icon:"🦇", hp:0.4, atk:0.8, def:0.2, xp:8,   gold:[1,3],   ini:12, isBoss:false },
  wolf:      { name:"Wolf",       icon:"🐺", hp:0.7, atk:0.9, def:0.3, xp:14,  gold:[3,7],   ini:10, isBoss:false },
  spider:    { name:"Riesenspin", icon:"🕷", hp:0.5, atk:1.0, def:0.2, xp:10,  gold:[2,5],   ini:9,  isBoss:false },
  treant:    { name:"Baumriese",  icon:"🌳", hp:2.3, atk:0.9, def:1.0, xp:34,  gold:[6,14],  ini:3,  isBoss:false },
  skeleton:  { name:"Skelett",    icon:"💀", hp:0.7, atk:0.8, def:0.4, xp:16,  gold:[4,8],   ini:7,  isBoss:false },
  zombie:    { name:"Zombie",     icon:"🧟", hp:1.3, atk:0.6, def:0.5, xp:20,  gold:[4,9],   ini:5,  isBoss:false },
  wraith:    { name:"Geist",      icon:"👻", hp:0.6, atk:1.3, def:0.1, xp:22,  gold:[5,10],  ini:11, isBoss:false },
  imp:       { name:"Imp",        icon:"😈", hp:0.5, atk:1.1, def:0.2, xp:14,  gold:[3,7],   ini:10, isBoss:false },
  golem:     { name:"Golem",      icon:"🗿", hp:2.6, atk:1.2, def:1.5, xp:40,  gold:[8,18],  ini:3,  isBoss:false },
  dragonling:{ name:"Drachling",  icon:"🐉", hp:5.5, atk:2.2, def:1.6, xp:150, gold:[30,70], ini:8,  isBoss:true  },
  lich:      { name:"Lich",       icon:"🧙", hp:4.5, atk:2.8, def:0.9, xp:160, gold:[35,80], ini:9,  isBoss:true  },
  demon:     { name:"Dämon",      icon:"👿", hp:5.0, atk:2.4, def:1.3, xp:155, gold:[32,75], ini:7,  isBoss:true  },
};

const BIOMES = {
  cave:   { name:"Höhle",  icon:"🏔", enemies:["goblin","troll","bat"],       boss:"dragonling", miniBoss:"troll",  roomCount:[16,24] },
  forest: { name:"Wald",   icon:"🌲", enemies:["wolf","spider","treant"],     boss:"lich",       miniBoss:"treant", roomCount:[17,25] },
  crypt:  { name:"Gruft",  icon:"⚰️", enemies:["skeleton","zombie","wraith"], boss:"lich",       miniBoss:"wraith", roomCount:[16,23] },
  volcano:{ name:"Vulkan", icon:"🌋", enemies:["imp","golem","imp"],          boss:"demon",      miniBoss:"golem",  roomCount:[15,22] },
};

const ITEM_SLOTS = ["weapon","helmet","armor","boots","ring","amulet"];
const ITEM_BASES = {
  weapon:["Schwert","Stab","Bogen","Kelch","Axt","Dolch","Hammer"],
  helmet:["Helm","Kapuze","Krone","Haube"],
  armor: ["Rüstung","Robe","Lederrüstung","Kettenhemd"],
  boots: ["Stiefel","Sandalen","Schuhe","Greaves"],
  ring:  ["Ring","Siegelring","Gemmenring"],
  amulet:["Amulett","Talisman","Medallion"],
};
const ITEM_PFXS = ["Alte","Mystische","Vergoldete","Dunkle","Heilige","Verzauberte","Uralte","Legendäre"];
const RARITY    = ["common","uncommon","rare","epic","legendary"];
const RARITY_W  = [50,30,15,4,1];

// ══════════════════════════════════════════════════════════════════
//  UTILITY
// ══════════════════════════════════════════════════════════════════

function seededRng(seed) {
  let s = seed;
  return () => { s=(s*1664525+1013904223)&0xffffffff; return (s>>>0)/0xffffffff; };
}
function randInt(rng,min,max) { return Math.floor(rng()*(max-min+1))+min; }
function randFrom(rng,arr)    { return arr[Math.floor(rng()*arr.length)]; }
function weightedRandom(rng,weights) {
  const t = weights.reduce((a,b)=>a+b,0);
  let r = rng()*t;
  for(let i=0;i<weights.length;i++){r-=weights[i];if(r<=0)return i;}
  return weights.length-1;
}
function d20() { return Math.floor(Math.random()*20)+1; }
function d6()  { return Math.floor(Math.random()*6)+1;  }
function d4()  { return Math.floor(Math.random()*4)+1;  }
function xpToLevel(xp) { return Math.max(1,Math.floor(1+Math.sqrt((xp||0)/50))); }

function getCharStats(char) {
  const cls = CLASSES[char.class];
  const lvl = xpToLevel(char.xp);
  let hp=cls.baseHp+(lvl-1)*cls.hpPerLevel, atk=cls.baseAtk+(lvl-1)*cls.atkPerLevel;
  let def=cls.baseDef+(lvl-1)*cls.defPerLevel, mana=cls.baseMana+(lvl-1)*cls.manaPerLevel;
  Object.values(char.equipment||{}).forEach(item=>{
    if(!item)return; const u=1+(item.upgrade||0)*0.15;
    atk+=(item.bonusAtk||0)*u; def+=(item.bonusDef||0)*u;
    hp+=(item.bonusHp||0)*u;   mana+=(item.bonusMana||0)*u;
  });
  return { hp:Math.round(hp), atk:Math.round(atk), def:Math.round(def), mana:Math.round(mana), level:lvl };
}

function scaleEnemy(type, avgLevel, playerCount) {
  const b = ENEMY_TYPES[type];
  const scale = 8+avgLevel*7, gBonus = 1+(playerCount-1)*0.28;
  return {
    type, name:b.name, icon:b.icon, isBoss:b.isBoss||false,
    maxHp:Math.round(b.hp*scale*gBonus), hp:Math.round(b.hp*scale*gBonus),
    atk:Math.round(b.atk*(5+avgLevel*4)*gBonus), def:Math.round(b.def*(2+avgLevel*1.5)),
    ini:b.ini+Math.floor(Math.random()*4),
    xpReward:Math.round(b.xp*(1+avgLevel*0.2)),
    goldReward:randInt(()=>Math.random(), b.gold[0]*avgLevel, b.gold[1]*avgLevel),
    stunned:0, buffs:{},
  };
}

function rollLoot(avgLevel, biome, isBoss, rng) {
  if(!isBoss && rng()>0.4) return null;
  const ri = weightedRandom(rng, isBoss?[5,20,35,30,10]:RARITY_W);
  const slot = randFrom(rng,ITEM_SLOTS);
  const name = `${randFrom(rng,ITEM_PFXS)} ${randFrom(rng,ITEM_BASES[slot])}`;
  const power = avgLevel*(1+ri*0.4)*(0.8+rng()*0.4);
  return {
    id:`item_${Date.now()}_${Math.floor(rng()*9999)}`,
    name, slot, rarity:RARITY[ri], upgrade:0,
    bonusAtk:  slot==="weapon"?Math.round(power*1.6):Math.round(power*0.3),
    bonusDef:  ["armor","helmet","boots"].includes(slot)?Math.round(power*1.3):Math.round(power*0.2),
    bonusHp:   Math.round(power*2.2*(0.5+rng()*0.5)),
    bonusMana: Math.round(power*(0.3+rng()*0.4)),
    value:     Math.round(10*Math.pow(3,ri)*(1+avgLevel*0.1)),
  };
}

// ══════════════════════════════════════════════════════════════════
//  DUNGEON GENERATION
// ══════════════════════════════════════════════════════════════════

function generateDungeon(seed, avgLevel, playerCount) {
  const rng = seededRng(seed);
  const biomeKey = randFrom(rng,Object.keys(BIOMES));
  const biome    = BIOMES[biomeKey];
  const roomCount = randInt(rng,biome.roomCount[0],biome.roomCount[1]);
  const rooms = [];

  for(let i=0; i<roomCount; i++) {
    const isBoss     = i===roomCount-1;
    const isMiniBoss = !isBoss && i>0 && i%7===0;
    const isRest     = !isBoss && !isMiniBoss && i>0 && i%3===0 && rng()<0.65;
    const isElite    = !isBoss && !isMiniBoss && !isRest && rng()<0.14 && i>1;
    const isShop     = !isBoss && !isMiniBoss && !isRest && !isElite && i>0 && rng()<0.1;
    const isTreasure = !isBoss && !isMiniBoss && !isRest && !isElite && !isShop && i>0 && rng()<0.1;
    const isEvent    = !isBoss && !isMiniBoss && !isRest && !isElite && !isShop && !isTreasure && i>0 && rng()<0.1;
    const eventType  = isEvent ? randFrom(rng,["trap","merchant","secret","ambush"]) : null;

    let enemies = [];
    if(!isShop && !isTreasure && !isRest) {
      const count = isBoss?1:isMiniBoss?1:isElite?randInt(rng,2,3):eventType==="ambush"?randInt(rng,4,6):randInt(rng,2,5);
      const lvlB  = isBoss?5:isMiniBoss?3:isElite?2:0;
      for(let e=0; e<count; e++) {
        const type = isBoss?biome.boss:isMiniBoss?biome.miniBoss:randFrom(rng,biome.enemies);
        const enemy = scaleEnemy(type, avgLevel+lvlB, playerCount);
        enemy.id = `e_${i}_${e}`;
        enemies.push(enemy);
      }
    }

    let chestLoot = null;
    if(isTreasure||(isBoss&&rng()<0.95)||(isMiniBoss&&rng()<0.75)||(isElite&&rng()<0.5))
      chestLoot = rollLoot(avgLevel+(isBoss?5:isMiniBoss?3:isElite?1:0),biomeKey,isBoss||isMiniBoss,rng);
    if(isEvent&&eventType==="secret")
      chestLoot = rollLoot(avgLevel+2,biomeKey,false,rng);

    let roomType = "normal";
    if(isBoss)         roomType="boss";
    else if(isMiniBoss)roomType="miniboss";
    else if(isRest)    roomType="rest";
    else if(isElite)   roomType="elite";
    else if(isShop)    roomType="shop";
    else if(isTreasure)roomType="treasure";
    else if(isEvent)   roomType="event";

    rooms.push({
      id:i, type:roomType, isBoss, isMiniBoss, isElite, isShop, isTreasure, isRest, isEvent, eventType,
      enemies, chestLoot,
      trapDamage: isEvent&&eventType==="trap"?randInt(rng,5,15)*avgLevel:0,
      bonusGold:  isEvent&&eventType==="merchant"?randInt(rng,20,60)*avgLevel:0,
      cleared: enemies.length===0,
      connections: i>0?[i-1]:[],
      combatState: null,
    });
    if(i>0) rooms[i-1].connections.push(i);
  }

  return { seed, biome:biomeKey, biomeName:biome.name, biomeIcon:biome.icon, avgLevel, playerCount, roomCount, rooms, currentRoom:0, completed:false, createdAt:Date.now() };
}

// ══════════════════════════════════════════════════════════════════
//  NAHEULBEUK COMBAT ENGINE
// ══════════════════════════════════════════════════════════════════

function rollAttack(atkStat, defStat, atkBonus=0, defBonus=0) {
  const atkDie=d20(), defDie=d20();
  const atkTotal=atkDie+Math.floor(atkStat/4)+atkBonus;
  const defTotal=defDie+Math.floor(defStat/4)+defBonus;
  return {
    atkDie, defDie, atkTotal, defTotal,
    hit:    atkDie===20 || (atkDie!==1 && atkTotal>defTotal),
    isCrit: atkDie===20,
    isPatzer: atkDie===1,
  };
}

function rollDamage(baseDmg, armor, isCrit, armorPen=0) {
  const wDmg = d6()+d4()+Math.floor(baseDmg/3);
  const eff  = Math.max(0, armor*(1-armorPen));
  return Math.max(1, Math.round(wDmg*(isCrit?2:1)-eff*0.5));
}

function initCombatState(room, players) {
  const units = [];
  players.forEach(p => {
    const stats = getCharStats(p.char);
    units.push({ kind:"player", id:p.playerId, name:p.char.name, icon:CLASSES[p.char.class]?.icon||"⚔️", initiative:d20()+Math.floor(stats.atk/8) });
  });
  room.enemies.forEach(e => {
    units.push({ kind:"enemy", id:e.id, name:e.name, icon:e.icon, initiative:e.ini||d20() });
  });
  units.sort((a,b)=>b.initiative-a.initiative);

  room.combatState = {
    round:1,
    turnOrder: units,
    currentTurnIdx:0,
    apLeft:2,
    skillCooldowns:{},
    trapActive:0,
  };
  return room.combatState;
}

function getCurrentTurn(cs) {
  return cs.turnOrder[cs.currentTurnIdx % cs.turnOrder.length];
}

function advanceTurn(room, players, sess) {
  const cs = room.combatState;
  cs.currentTurnIdx++;
  if(cs.currentTurnIdx >= cs.turnOrder.length) {
    cs.currentTurnIdx=0;
    cs.round++;
    players.forEach(p=>{ if(!p.buffs)return; Object.keys(p.buffs).forEach(k=>{if(p.buffs[k]>0)p.buffs[k]--;}); });
    room.enemies.forEach(e=>{ if(!e.buffs)return; Object.keys(e.buffs).forEach(k=>{if(e.buffs[k]>0)e.buffs[k]--;}); });
    Object.values(cs.skillCooldowns).forEach(cds=>{ Object.keys(cds).forEach(sk=>{if(cds[sk]>0)cds[sk]--;}); });
  }
  // Skip dead units
  let safety=0;
  while(safety++<20) {
    const t = getCurrentTurn(cs);
    if(t.kind==="player") {
      const p=players.find(p=>p.playerId===t.id);
      if(p && p.currentHp>0) break;
    } else {
      const e=room.enemies.find(e=>e.id===t.id);
      if(e && e.hp>0) break;
    }
    cs.currentTurnIdx++;
    if(cs.currentTurnIdx>=cs.turnOrder.length){cs.currentTurnIdx=0;cs.round++;}
  }
  const turn=getCurrentTurn(cs);
  if(turn.kind==="player") cs.apLeft=2;
  return turn;
}

function processEnemyTurn(enemy, players, sess) {
  const events=[];
  if(enemy.hp<=0) return events;
  if(enemy.stunned>0){ enemy.stunned--; events.push({type:"enemy_stunned",enemyId:enemy.id,name:enemy.name}); return events; }

  const alive=players.filter(p=>p.currentHp>0);
  if(!alive.length) return events;
  const target=alive.sort((a,b)=>a.currentHp-b.currentHp)[0];
  const stats=getCharStats(target.char);
  const pDef=stats.def+(target.buffs?.def||0);
  const pPar=(target.buffs?.parade||0);
  const roll=rollAttack(enemy.atk, pDef, 0, pPar);

  if(roll.isPatzer) {
    events.push({type:"enemy_patzer",enemyId:enemy.id,name:enemy.name,targetId:target.playerId}); return events;
  }
  if(roll.hit) {
    let dmg=rollDamage(enemy.atk, pDef, roll.isCrit);
    // Trap check
    if(sess.trapActive>0) {
      sess.trapActive--;
      enemy.hp=Math.max(0,enemy.hp-dmg);
      events.push({type:"trap_triggered",enemyId:enemy.id,name:enemy.name,damage:dmg,enemyHp:enemy.hp});
      if(enemy.hp<=0){events.push({type:"enemy_died",enemyId:enemy.id,name:enemy.name});return events;}
    }
    target.currentHp=Math.max(0,target.currentHp-dmg);
    events.push({type:"enemy_attack",enemyId:enemy.id,enemyName:enemy.name,targetId:target.playerId,targetName:target.char.name,damage:dmg,isCrit:roll.isCrit,rolls:{atk:roll.atkTotal,def:roll.defTotal},hp:target.currentHp,maxHp:target.maxHp});
    if(target.currentHp<=0) events.push({type:"player_died",playerId:target.playerId,name:target.char.name});
  } else {
    events.push({type:"enemy_miss",enemyId:enemy.id,enemyName:enemy.name,targetId:target.playerId,rolls:{atk:roll.atkTotal,def:roll.defTotal}});
  }
  return events;
}

function applySkill(skillId, caster, targetEnemyId, targetPlayerId, room, sess, allPlayers) {
  const events=[], stats=getCharStats(caster.char);
  const enemies=room.enemies;
  const enemy=enemies.find(e=>e.id===targetEnemyId);

  switch(skillId) {
    case "heavy_strike": {
      if(!enemy||enemy.hp<=0) break;
      const roll=rollAttack(stats.atk*1.5,enemy.def-2);
      if(roll.isPatzer){events.push({type:"player_patzer",playerId:caster.playerId,name:caster.char.name});break;}
      if(roll.hit){
        const dmg=rollDamage(stats.atk*1.5,enemy.def,roll.isCrit);
        enemy.hp=Math.max(0,enemy.hp-dmg);
        events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:enemy.id,targetName:enemy.name,damage:dmg,isCrit:roll.isCrit,rolls:{atk:roll.atkTotal,def:roll.defTotal},enemyHp:enemy.hp,enemyMaxHp:enemy.maxHp});
        if(enemy.hp<=0)events.push({type:"enemy_died",enemyId:enemy.id,name:enemy.name});
      } else events.push({type:"skill_miss",skillId,casterId:caster.playerId,rolls:{atk:roll.atkTotal,def:roll.defTotal}});
      break;
    }
    case "shield_bash": {
      if(!enemy||enemy.hp<=0) break;
      const roll=rollAttack(stats.atk*0.8,enemy.def);
      if(roll.hit){
        const dmg=rollDamage(stats.atk*0.5,enemy.def,false);
        enemy.hp=Math.max(0,enemy.hp-dmg); enemy.stunned=1;
        events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:enemy.id,targetName:enemy.name,damage:dmg,stunned:true,enemyHp:enemy.hp,enemyMaxHp:enemy.maxHp});
        if(enemy.hp<=0)events.push({type:"enemy_died",enemyId:enemy.id,name:enemy.name});
      } else events.push({type:"skill_miss",skillId,casterId:caster.playerId});
      break;
    }
    case "war_cry": {
      allPlayers.forEach(p=>{if(!p.buffs)p.buffs={};p.buffs.atk=(p.buffs.atk||0)+3;});
      events.push({type:"skill_buff",skillId,casterId:caster.playerId,casterName:caster.char.name,effect:"⚔ +3 ATK alle Helden",duration:3});
      break;
    }
    case "defend": {
      if(!caster.buffs)caster.buffs={};
      caster.buffs.def=(caster.buffs.def||0)+5;
      events.push({type:"skill_buff",skillId,casterId:caster.playerId,casterName:caster.char.name,effect:"🛡 +5 Rüstung",duration:1});
      break;
    }
    case "fireball": {
      enemies.filter(e=>e.hp>0).forEach(e=>{
        const dmg=rollDamage(stats.atk*1.2,e.def*0.5,false,0.3);
        e.hp=Math.max(0,e.hp-dmg);
        events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:e.id,targetName:e.name,damage:dmg,aoe:true,enemyHp:e.hp,enemyMaxHp:e.maxHp});
        if(e.hp<=0)events.push({type:"enemy_died",enemyId:e.id,name:e.name});
      });
      break;
    }
    case "magic_missile": {
      if(!enemy||enemy.hp<=0) break;
      const dmg=rollDamage(stats.atk*1.2,0,false);
      enemy.hp=Math.max(0,enemy.hp-dmg);
      events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:enemy.id,targetName:enemy.name,damage:dmg,armorIgnored:true,enemyHp:enemy.hp,enemyMaxHp:enemy.maxHp});
      if(enemy.hp<=0)events.push({type:"enemy_died",enemyId:enemy.id,name:enemy.name});
      break;
    }
    case "arcane_shield": {
      if(!caster.buffs)caster.buffs={};
      caster.buffs.def=(caster.buffs.def||0)+6;
      events.push({type:"skill_buff",skillId,casterId:caster.playerId,casterName:caster.char.name,effect:"🔮 +6 Rüstung",duration:2});
      break;
    }
    case "mana_burst": {
      if(!enemy||enemy.hp<=0) break;
      const hpCost=Math.round(caster.maxHp*0.15);
      caster.currentHp=Math.max(1,caster.currentHp-hpCost);
      const dmg=rollDamage(stats.atk*2.5,enemy.def*0.3,false);
      enemy.hp=Math.max(0,enemy.hp-dmg);
      events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:enemy.id,targetName:enemy.name,damage:dmg,hpCost,playerHp:caster.currentHp,playerMaxHp:caster.maxHp,enemyHp:enemy.hp,enemyMaxHp:enemy.maxHp});
      if(enemy.hp<=0)events.push({type:"enemy_died",enemyId:enemy.id,name:enemy.name});
      break;
    }
    case "aimed_shot": {
      if(!enemy||enemy.hp<=0) break;
      const dmg=rollDamage(stats.atk*1.8,enemy.def,true);
      enemy.hp=Math.max(0,enemy.hp-dmg);
      events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:enemy.id,targetName:enemy.name,damage:dmg,isCrit:true,enemyHp:enemy.hp,enemyMaxHp:enemy.maxHp});
      if(enemy.hp<=0)events.push({type:"enemy_died",enemyId:enemy.id,name:enemy.name});
      break;
    }
    case "multi_shot": {
      enemies.filter(e=>e.hp>0).slice(0,3).forEach(e=>{
        const roll=rollAttack(stats.atk*0.8,e.def);
        if(roll.hit){
          const dmg=rollDamage(stats.atk*0.7,e.def,false);
          e.hp=Math.max(0,e.hp-dmg);
          events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:e.id,targetName:e.name,damage:dmg,enemyHp:e.hp,enemyMaxHp:e.maxHp});
          if(e.hp<=0)events.push({type:"enemy_died",enemyId:e.id,name:e.name});
        }
      });
      break;
    }
    case "set_trap": {
      sess.trapActive=2;
      events.push({type:"skill_buff",skillId,casterId:caster.playerId,casterName:caster.char.name,effect:"🪤 Falle gestellt",duration:2});
      break;
    }
    case "evade": {
      if(!caster.buffs)caster.buffs={};
      caster.buffs.parade=(caster.buffs.parade||0)+8;
      events.push({type:"skill_buff",skillId,casterId:caster.playerId,casterName:caster.char.name,effect:"💨 +8 Parade",duration:1});
      break;
    }
    case "heal": {
      const tP=allPlayers.find(p=>p.playerId===targetPlayerId)||caster;
      const amt=Math.round(stats.atk*1.8+d6()*4);
      tP.currentHp=Math.min(tP.maxHp,tP.currentHp+amt);
      events.push({type:"skill_heal",skillId,casterId:caster.playerId,targetId:tP.playerId,targetName:tP.char.name,amount:amt,hp:tP.currentHp,maxHp:tP.maxHp});
      break;
    }
    case "group_heal": {
      allPlayers.forEach(p=>{
        const amt=Math.round(stats.atk*0.9+d6()*3);
        p.currentHp=Math.min(p.maxHp,p.currentHp+amt);
        events.push({type:"skill_heal",skillId,casterId:caster.playerId,targetId:p.playerId,targetName:p.char.name,amount:amt,hp:p.currentHp,maxHp:p.maxHp});
      });
      break;
    }
    case "holy_light": {
      if(!enemy||enemy.hp<=0) break;
      const dmg=rollDamage(stats.atk*1.1,0,false);
      enemy.hp=Math.max(0,enemy.hp-dmg);
      events.push({type:"skill_hit",skillId,casterId:caster.playerId,targetId:enemy.id,targetName:enemy.name,damage:dmg,armorIgnored:true,enemyHp:enemy.hp,enemyMaxHp:enemy.maxHp});
      if(enemy.hp<=0)events.push({type:"enemy_died",enemyId:enemy.id,name:enemy.name});
      break;
    }
    case "revive": {
      const dead=allPlayers.find(p=>p.currentHp<=0);
      if(dead){
        dead.currentHp=Math.round(dead.maxHp*0.3);
        events.push({type:"skill_revive",skillId,casterId:caster.playerId,targetId:dead.playerId,targetName:dead.char.name,hp:dead.currentHp,maxHp:dead.maxHp});
      }
      break;
    }
  }
  return events;
}

function giveRewards(sess, enemy) {
  const events=[];
  sess.players.forEach(p=>{
    p.char.xp=(p.char.xp||0)+enemy.xpReward;
    const gold=Math.round(enemy.goldReward/sess.players.length);
    const oldLvl=xpToLevel(p.char.xp-enemy.xpReward);
    const newLvl=xpToLevel(p.char.xp);
    events.push({type:"rewards",playerId:p.playerId,xp:enemy.xpReward,gold});
    if(newLvl>oldLvl) events.push({type:"level_up",playerId:p.playerId,level:newLvl});
    supabase.from("rpg_characters").update({xp:p.char.xp}).eq("id",p.char.id).catch(()=>{});
    supabase.from("rpg_players").select("gold").eq("id",p.playerId).then(async({data})=>{
      if(data)await supabase.from("rpg_players").update({gold:(data.gold||0)+gold}).eq("id",p.playerId).catch(()=>{});
    }).catch(()=>{});
    const drop=rollLoot(sess.dungeon.avgLevel,sess.dungeon.biome,enemy.isBoss,()=>Math.random());
    if(drop){
      p.char.inventory=[...(p.char.inventory||[]),drop];
      events.push({type:"item_drop",playerId:p.playerId,item:drop});
      supabase.from("rpg_characters").update({inventory:p.char.inventory}).eq("id",p.char.id).catch(()=>{});
    }
  });
  return events;
}

function checkRoomCleared(room, sess, sessionCode) {
  if(room.enemies.every(e=>e.hp<=0) && !room.cleared) {
    room.cleared=true;
    const events=[{type:"room_cleared",roomId:sess.dungeon.currentRoom,chestLoot:room.chestLoot}];
    // Rewards for all enemies
    room.enemies.forEach(e=>{ if(e.xpReward) events.push(...giveRewards(sess,e)); });
    if(room.isBoss){
      sess.dungeon.completed=true; sess.state="completed";
      sess.players.forEach(p=>{ p.char.dungeons_cleared=(p.char.dungeons_cleared||0)+1; supabase.from("rpg_characters").update({dungeons_cleared:p.char.dungeons_cleared}).eq("id",p.char.id).catch(()=>{}); });
      events.push({type:"dungeon_completed",biomeName:sess.dungeon.biomeName});
    }
    return events;
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════
//  SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════════

const sessions=new Map(), clients=new Map();
const CODE_CHARS="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(){let c;do{c=Array.from({length:5},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join("");}while(sessions.has(c));return c;}
function bcast(code,msg,excl=null){const s=sessions.get(code);if(!s)return;const str=JSON.stringify(msg);s.players.forEach(({ws})=>{if(ws!==excl&&ws.readyState===WebSocket.OPEN)ws.send(str);});}
function bcastAll(code,msg){bcast(code,msg,null);}
function getAvgLevel(sess){const t=sess.players.reduce((s,p)=>s+xpToLevel(p.char?.xp||0),0);return Math.max(1,Math.round(t/Math.max(1,sess.players.length)));}

// ══════════════════════════════════════════════════════════════════
//  WEBSOCKET HANDLER
// ══════════════════════════════════════════════════════════════════

wss.on("connection", ws => {
  clients.set(ws,{playerId:null,charId:null,sessionCode:null,char:null});

  ws.on("message", async raw => {
    let msg; try{msg=JSON.parse(raw);}catch{return;}
    const client=clients.get(ws);
    try {

    switch(msg.type) {

      case "login": {
        if(!msg.token){ws.send(JSON.stringify({type:"error",msg:"Kein Token"}));break;}
        const authUser=await verifyToken(msg.token);
        if(!authUser){ws.send(JSON.stringify({type:"error",msg:"Token ungültig"}));ws.close();break;}
        client.playerId=authUser.id;
        let player=null;
        try{const{data}=await supabase.from("rpg_players").select("*").eq("id",authUser.id).single();player=data;}catch{}
        if(!player){
          try{const{data}=await supabase.from("rpg_players").insert({id:authUser.id,name:msg.name||authUser.name,gold:100,created_at:new Date().toISOString()}).select().single();player=data;}catch(e){console.error("[LOGIN]",e.message);}
        }
        let chars=[];
        try{const{data}=await supabase.from("rpg_characters").select("*").eq("player_id",authUser.id);chars=data||[];}catch{}
        console.log(`[LOGIN] ${authUser.name} (${authUser.id.slice(0,8)})`);
        ws.send(JSON.stringify({type:"login_ok",player:player||{id:authUser.id,name:authUser.name,gold:100},characters:chars}));
        break;
      }

      case "create_char": {
        if(!CLASSES[msg.class])break;
        const nc={player_id:client.playerId,name:(msg.name||"Held").slice(0,20),class:msg.class,xp:0,build:null,equipment:{},inventory:[],dungeons_cleared:0,created_at:new Date().toISOString()};
        const{data:char,error}=await supabase.from("rpg_characters").insert(nc).select().single();
        if(error){ws.send(JSON.stringify({type:"error",msg:error.message}));break;}
        ws.send(JSON.stringify({type:"char_created",character:char}));
        break;
      }

      case "select_char": {
        const{data:char}=await supabase.from("rpg_characters").select("*").eq("id",msg.charId).eq("player_id",client.playerId).single();
        if(!char)break;
        client.charId=char.id; client.char=char;
        ws.send(JSON.stringify({type:"char_selected",character:char,stats:getCharStats(char),skills:CLASS_SKILLS[char.class]||[]}));
        break;
      }

      case "set_build": {
        if(!client.charId)break;
        await supabase.from("rpg_characters").update({build:msg.build}).eq("id",client.charId);
        client.char.build=msg.build;
        ws.send(JSON.stringify({type:"build_set",build:msg.build}));
        break;
      }

      case "equip_item": {
        if(!client.charId||!client.char)break;
        const inv=[...(client.char.inventory||[])];
        const idx=inv.findIndex(i=>i.id===msg.itemId);
        if(idx===-1)break;
        const item=inv[idx];
        const equip={...(client.char.equipment||{})};
        if(equip[item.slot])inv.push(equip[item.slot]);
        equip[item.slot]=item; inv.splice(idx,1);
        await supabase.from("rpg_characters").update({equipment:equip,inventory:inv}).eq("id",client.charId);
        client.char.equipment=equip; client.char.inventory=inv;
        ws.send(JSON.stringify({type:"char_updated",character:client.char,stats:getCharStats(client.char)}));
        break;
      }

      case "upgrade_item": {
        if(!client.charId||!client.char)break;
        const equip=client.char.equipment||{};
        const item=equip[msg.slot];
        if(!item||item.upgrade>=5)break;
        const cost=Math.round(item.value*(1+item.upgrade)*0.5);
        const{data:pd}=await supabase.from("rpg_players").select("gold").eq("id",client.playerId).single();
        if(!pd||pd.gold<cost){ws.send(JSON.stringify({type:"error",msg:"Nicht genug Gold"}));break;}
        item.upgrade++;
        await supabase.from("rpg_players").update({gold:pd.gold-cost}).eq("id",client.playerId);
        await supabase.from("rpg_characters").update({equipment:equip}).eq("id",client.charId);
        client.char.equipment=equip;
        ws.send(JSON.stringify({type:"item_upgraded",slot:msg.slot,item,goldSpent:cost,newGold:pd.gold-cost}));
        break;
      }

      case "create_session": {
        if(!client.char){ws.send(JSON.stringify({type:"error",msg:"Kein Charakter"}));break;}
        const code=genCode();
        sessions.set(code,{code,host:client.playerId,players:[{ws,playerId:client.playerId,char:client.char,currentHp:0,maxHp:0,currentMana:0,maxMana:0,buffs:{}}],dungeon:null,state:"lobby",trapActive:0});
        client.sessionCode=code;
        ws.send(JSON.stringify({type:"session_created",code,players:[{id:client.playerId,name:client.char.name,class:client.char.class,stats:getCharStats(client.char)}]}));
        break;
      }

      case "join_session": {
        if(!client.char){ws.send(JSON.stringify({type:"error",msg:"Kein Charakter"}));break;}
        const code=msg.code?.toUpperCase().trim();
        const sess=sessions.get(code);
        if(!sess){ws.send(JSON.stringify({type:"error",msg:"Session nicht gefunden"}));break;}
        if(sess.state!=="lobby"){ws.send(JSON.stringify({type:"error",msg:"Bereits gestartet"}));break;}
        if(sess.players.length>=4){ws.send(JSON.stringify({type:"error",msg:"Gruppe voll"}));break;}
        sess.players.push({ws,playerId:client.playerId,char:client.char,currentHp:0,maxHp:0,currentMana:0,maxMana:0,buffs:{}});
        client.sessionCode=code;
        const pl=sess.players.map(p=>({id:p.playerId,name:p.char.name,class:p.char.class,stats:getCharStats(p.char)}));
        bcastAll(code,{type:"player_joined",players:pl});
        break;
      }

      case "leave_session": removeFromSession(ws,client); break;

      case "start_dungeon": {
        const sess=sessions.get(client.sessionCode);
        if(!sess||sess.host!==client.playerId||sess.state!=="lobby")break;
        const avgLvl=getAvgLevel(sess);
        sess.dungeon=generateDungeon(Date.now()%999999,avgLvl,sess.players.length);
        sess.state="dungeon";
        sess.players.forEach(p=>{const s=getCharStats(p.char);p.currentHp=s.hp;p.maxHp=s.hp;p.currentMana=s.mana;p.maxMana=s.mana;p.buffs={};});
        bcastAll(client.sessionCode,{type:"dungeon_started",dungeon:sess.dungeon,playerStates:sess.players.map(p=>({id:p.playerId,name:p.char.name,class:p.char.class,build:p.char.build,hp:p.currentHp,maxHp:p.maxHp,mana:p.currentMana,maxMana:p.maxMana,stats:getCharStats(p.char),skills:CLASS_SKILLS[p.char.class]||[]}))});
        console.log(`[DUNGEON] ${client.sessionCode}: ${sess.dungeon.biomeName}, ${sess.dungeon.roomCount} Räume, ⌀Lvl ${avgLvl}`);
        break;
      }

      case "move_room": {
        const sess=sessions.get(client.sessionCode);
        if(!sess?.dungeon)break;
        const d=sess.dungeon;
        const curRoom=d.rooms[d.currentRoom];
        if(!curRoom.cleared){ws.send(JSON.stringify({type:"error",msg:"Raum nicht befreit!"}));break;}
        if(!curRoom.connections.includes(msg.roomId))break;
        d.currentRoom=msg.roomId;
        const room=d.rooms[msg.roomId];
        if(room.enemies.length>0&&!room.cleared) {
          const cs=initCombatState(room,sess.players);
          bcastAll(client.sessionCode,{type:"combat_started",roomId:msg.roomId,room,combatState:cs,currentTurn:getCurrentTurn(cs),enemies:room.enemies,playerStates:sess.players.map(p=>({id:p.playerId,hp:p.currentHp,maxHp:p.maxHp}))});
        } else {
          bcastAll(client.sessionCode,{type:"room_changed",roomId:msg.roomId,room});
        }
        break;
      }

      case "player_attack": {
        const sess=sessions.get(client.sessionCode);
        if(!sess?.dungeon)break;
        const room=sess.dungeon.rooms[sess.dungeon.currentRoom];
        const cs=room.combatState;
        if(!cs)break;
        const turn=getCurrentTurn(cs);
        if(turn.kind!=="player"||turn.id!==client.playerId){ws.send(JSON.stringify({type:"error",msg:"Nicht dein Zug!"}));break;}
        if(cs.apLeft<1){ws.send(JSON.stringify({type:"error",msg:"Keine AP mehr"}));break;}
        const attacker=sess.players.find(p=>p.playerId===client.playerId);
        const enemy=room.enemies.find(e=>e.id===msg.targetId&&e.hp>0);
        if(!attacker||attacker.currentHp<=0||!enemy)break;

        const stats=getCharStats(attacker.char);
        const atkBonus=(attacker.buffs?.atk||0);
        const roll=rollAttack(stats.atk+atkBonus, enemy.def+(enemy.buffs?.def||0));
        const events=[];

        if(roll.isPatzer){
          events.push({type:"player_patzer",playerId:client.playerId,name:attacker.char.name});
        } else if(roll.hit){
          const dmg=rollDamage(stats.atk, enemy.def, roll.isCrit);
          enemy.hp=Math.max(0,enemy.hp-dmg);
          events.push({type:"player_attack",playerId:client.playerId,name:attacker.char.name,targetId:enemy.id,targetName:enemy.name,damage:dmg,isCrit:roll.isCrit,rolls:{atk:roll.atkTotal,def:roll.defTotal},enemyHp:enemy.hp,enemyMaxHp:enemy.maxHp});
        } else {
          events.push({type:"attack_miss",playerId:client.playerId,name:attacker.char.name,targetId:enemy.id,targetName:enemy.name,rolls:{atk:roll.atkTotal,def:roll.defTotal}});
        }

        events.push(...checkRoomCleared(room,sess,client.sessionCode));
        cs.apLeft--;

        // Auto-advance if AP=0
        let nextTurn=turn;
        if(cs.apLeft<=0) {
          nextTurn=advanceTurn(room,sess.players,sess);
          events.push({type:"turn_changed",turn:nextTurn,round:cs.round,apLeft:cs.apLeft});
          // Process enemy turns
          while(nextTurn.kind==="enemy") {
            const enem=room.enemies.find(e=>e.id===nextTurn.id&&e.hp>0);
            if(enem) events.push(...processEnemyTurn(enem,sess.players,sess));
            if(room.cleared||sess.players.every(p=>p.currentHp<=0)) break;
            nextTurn=advanceTurn(room,sess.players,sess);
            events.push({type:"turn_changed",turn:nextTurn,round:cs.round,apLeft:cs.apLeft});
          }
        } else {
          events.push({type:"ap_update",apLeft:cs.apLeft});
        }

        if(sess.players.every(p=>p.currentHp<=0)){events.push({type:"dungeon_failed"});sess.state="completed";}
        bcastAll(client.sessionCode,{type:"combat_events",events,combatState:{round:cs.round,apLeft:cs.apLeft,currentTurn:getCurrentTurn(cs)}});
        break;
      }

      case "end_turn": {
        const sess=sessions.get(client.sessionCode);
        if(!sess?.dungeon)break;
        const room=sess.dungeon.rooms[sess.dungeon.currentRoom];
        const cs=room.combatState;
        if(!cs)break;
        const turn=getCurrentTurn(cs);
        if(turn.kind!=="player"||turn.id!==client.playerId)break;
        const events=[];
        cs.apLeft=0;
        let nextTurn=advanceTurn(room,sess.players,sess);
        events.push({type:"turn_changed",turn:nextTurn,round:cs.round,apLeft:cs.apLeft});
        while(nextTurn.kind==="enemy") {
          const enem=room.enemies.find(e=>e.id===nextTurn.id&&e.hp>0);
          if(enem) events.push(...processEnemyTurn(enem,sess.players,sess));
          if(room.cleared||sess.players.every(p=>p.currentHp<=0)) break;
          nextTurn=advanceTurn(room,sess.players,sess);
          events.push({type:"turn_changed",turn:nextTurn,round:cs.round,apLeft:cs.apLeft});
        }
        if(sess.players.every(p=>p.currentHp<=0)){events.push({type:"dungeon_failed"});sess.state="completed";}
        bcastAll(client.sessionCode,{type:"combat_events",events,combatState:{round:cs.round,apLeft:cs.apLeft,currentTurn:getCurrentTurn(cs)}});
        break;
      }

      case "use_skill": {
        const sess=sessions.get(client.sessionCode);
        if(!sess?.dungeon)break;
        const room=sess.dungeon.rooms[sess.dungeon.currentRoom];
        const cs=room.combatState;
        if(!cs)break;
        const turn=getCurrentTurn(cs);
        if(turn.kind!=="player"||turn.id!==client.playerId){ws.send(JSON.stringify({type:"error",msg:"Nicht dein Zug!"}));break;}
        const skill=CLASS_SKILLS[client.char?.class]?.find(s=>s.id===msg.skillId);
        if(!skill)break;
        if(cs.apLeft<skill.ap){ws.send(JSON.stringify({type:"error",msg:`Nicht genug AP (brauche ${skill.ap}, habe ${cs.apLeft})`}));break;}
        if(!cs.skillCooldowns[client.playerId])cs.skillCooldowns[client.playerId]={};
        const cd=cs.skillCooldowns[client.playerId][msg.skillId]||0;
        if(cd>0){ws.send(JSON.stringify({type:"error",msg:`Cooldown: noch ${cd} Runde(n)`}));break;}
        const caster=sess.players.find(p=>p.playerId===client.playerId);
        if(!caster||caster.currentHp<=0)break;

        const events=applySkill(msg.skillId,caster,msg.targetEnemyId,msg.targetPlayerId,room,sess,sess.players);
        if(skill.cooldown>0)cs.skillCooldowns[client.playerId][msg.skillId]=skill.cooldown;
        cs.apLeft-=skill.ap;
        events.push(...checkRoomCleared(room,sess,client.sessionCode));

        let nextTurn=getCurrentTurn(cs);
        if(cs.apLeft<=0) {
          nextTurn=advanceTurn(room,sess.players,sess);
          events.push({type:"turn_changed",turn:nextTurn,round:cs.round,apLeft:cs.apLeft});
          while(nextTurn.kind==="enemy") {
            const enem=room.enemies.find(e=>e.id===nextTurn.id&&e.hp>0);
            if(enem) events.push(...processEnemyTurn(enem,sess.players,sess));
            if(room.cleared||sess.players.every(p=>p.currentHp<=0)) break;
            nextTurn=advanceTurn(room,sess.players,sess);
            events.push({type:"turn_changed",turn:nextTurn,round:cs.round,apLeft:cs.apLeft});
          }
        } else {
          events.push({type:"ap_update",apLeft:cs.apLeft});
        }

        if(sess.players.every(p=>p.currentHp<=0)){events.push({type:"dungeon_failed"});sess.state="completed";}
        bcastAll(client.sessionCode,{type:"combat_events",events,combatState:{round:cs.round,apLeft:cs.apLeft,currentTurn:getCurrentTurn(cs),cooldowns:cs.skillCooldowns}});
        break;
      }

      case "take_chest": {
        const sess=sessions.get(client.sessionCode);
        if(!sess?.dungeon)break;
        const room=sess.dungeon.rooms[sess.dungeon.currentRoom];
        if(!room.chestLoot||room.chestTaken)break;
        room.chestTaken=true;
        const taker=sess.players.find(p=>p.playerId===client.playerId);
        if(!taker)break;
        taker.char.inventory=[...(taker.char.inventory||[]),room.chestLoot];
        await supabase.from("rpg_characters").update({inventory:taker.char.inventory}).eq("id",taker.char.id).catch(()=>{});
        bcastAll(client.sessionCode,{type:"chest_taken",playerId:client.playerId,item:room.chestLoot});
        break;
      }

      case "rest_room": {
        const sess=sessions.get(client.sessionCode);
        if(!sess?.dungeon)break;
        const room=sess.dungeon.rooms[sess.dungeon.currentRoom];
        if(room.type!=="rest")break;
        sess.players.forEach(p=>{
          const amt=Math.round(p.maxHp*0.4);
          p.currentHp=Math.min(p.maxHp,p.currentHp+amt);
        });
        bcastAll(client.sessionCode,{type:"rested",playerStates:sess.players.map(p=>({id:p.playerId,hp:p.currentHp,maxHp:p.maxHp})),healPct:40});
        break;
      }

      case "enter_combat": {
        const sess=sessions.get(client.sessionCode);
        if(!sess?.dungeon)break;
        const roomId=sess.dungeon.currentRoom;
        const room=sess.dungeon.rooms[roomId];
        if(!room)break;
        // Always reinit if cleared or no enemies
        if(room.cleared||!room.enemies||!room.enemies.length) {
          // Room is safe - send room_changed instead
          ws.send(JSON.stringify({type:"room_changed",roomId,room}));
          break;
        }
        // Init or reuse combat state
        if(!room.combatState) initCombatState(room,sess.players);
        const cs=room.combatState;
        bcastAll(client.sessionCode,{
          type:"combat_started",
          roomId,
          room,
          combatState:cs,
          currentTurn:getCurrentTurn(cs),
          enemies:room.enemies,
          playerStates:sess.players.map(p=>({id:p.playerId,hp:p.currentHp,maxHp:p.maxHp,mana:p.currentMana,maxMana:p.maxMana}))
        });
        console.log(`[COMBAT] Raum ${roomId}: ${room.enemies.length} Gegner, ${sess.players.length} Spieler`);
        break;
      }

      case "ping": ws.send(JSON.stringify({type:"pong",t:msg.t})); break;
    }

    } catch(err) {
      console.error("[WS ERROR]",err.message,err.stack);
      try{ws.send(JSON.stringify({type:"error",msg:"Server-Fehler: "+err.message}));}catch{}
    }
  });

  ws.on("close",()=>{ const c=clients.get(ws); if(c)removeFromSession(ws,c); clients.delete(ws); });
  ws.on("error",err=>console.error("[WS]",err.message));
});

function removeFromSession(ws,client) {
  const code=client.sessionCode; if(!code)return;
  const sess=sessions.get(code); if(!sess)return;
  sess.players=sess.players.filter(p=>p.ws!==ws);
  if(sess.players.length===0){sessions.delete(code);console.log(`[SESSION] ${code} gelöscht`);}
  else{if(sess.host===client.playerId)sess.host=sess.players[0].playerId;bcast(code,{type:"player_left",playerId:client.playerId});}
  client.sessionCode=null;
}

// ══════════════════════════════════════════════════════════════════
//  REST API
// ══════════════════════════════════════════════════════════════════

app.get("/",(_,res)=>res.json({status:"ok",sessions:sessions.size,clients:clients.size}));
app.get("/classes",(_,res)=>res.json({classes:CLASSES,skills:CLASS_SKILLS}));
app.get("/leaderboard",async(_,res)=>{
  try{const{data}=await supabase.from("rpg_characters").select("name,class,xp,dungeons_cleared").order("xp",{ascending:false}).limit(20);res.json(data||[]);}
  catch{res.json([]);}
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`RPG Server läuft auf Port ${PORT}`));

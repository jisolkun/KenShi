// Weapon definitions share their authored motion and combat timings.
import { getReviewedAttack } from './choreography/index.js';
import { createSourceWeaponMoves } from './sourceMotion/catalogue.js';
import { getSourceAttackRule } from './sourceMotion/combat.js';
import {HAMMER_ID,HAMMER_WEAPON} from './customHammer/definition.js';
export const DEFAULT_WEAPON_ID = 'dual-dao';
export const UNLOCKED_WEAPON_IDS = new Set(['dual-dao', 'tang-dao', 'great-dao', HAMMER_ID]);
export function isWeaponUnlocked(id) { return UNLOCKED_WEAPON_IDS.has(id); }
export const WEAPON_TYPES = [
  {
    "id": "dual-dao",
    "name": "双刀",
    "category": "刀剑",
    "tagline": "双锋连环，步步追魂",
    "description": "双手交替劈斩的短刀，以交叉封挡和贴身连击压制敌人。",
    "grip": "dual",
    "effectColor": 6939870,
    "effectAccent": 15137791,
    "stats": {
      "speed": 5,
      "power": 3,
      "reach": 2
    },
    "moves": [
      {
        "name": "燕返",
        "duration": 0.31,
        "contact": 0.43,
        "active": [
          0.38,
          0.58
        ],
        "damage": 22.0,
        "reach": 1.8,
        "shape": "arc",
        "halfAngle": 1.12,
        "width": 0.325,
        "lunge": 0.65,
        "knockback": 0.56,
        "hitstop": 0.043
      },
      {
        "name": "交锋",
        "duration": 0.347,
        "contact": 0.43,
        "active": [
          0.38,
          0.58
        ],
        "damage": 24.64,
        "reach": 1.91,
        "shape": "arc",
        "halfAngle": 1.12,
        "width": 0.353,
        "lunge": 0.423,
        "knockback": 0.63,
        "hitstop": 0.046
      },
      {
        "name": "穿花",
        "duration": 0.291,
        "contact": 0.47,
        "active": [
          0.4,
          0.62
        ],
        "damage": 19.8,
        "reach": 1.69,
        "shape": "thrust",
        "halfAngle": 0.31,
        "width": 0.34,
        "lunge": 0.78,
        "knockback": 0.7,
        "hitstop": 0.049
      },
      {
        "name": "双月",
        "duration": 0.44,
        "contact": 0.48,
        "active": [
          0.42,
          0.72
        ],
        "damage": 36.3,
        "reach": 2.07,
        "shape": "radial",
        "halfAngle": 3.142,
        "width": 0.409,
        "lunge": 0.533,
        "knockback": 0.77,
        "hitstop": 0.052
      }
    ]
  },
  {
    "id": "tang-dao",
    "name": "砍刀",
    "category": "刀剑",
    "tagline": "转胯大斩，横扫敌阵",
    "description": "修长直刃配环首刀柄，收刀蓄势后以干净的斜斩破开防线。",
    "grip": "twohand",
    "effectColor": 16761707,
    "effectAccent": 15137791,
    "stats": {
      "speed": 3,
      "power": 4,
      "reach": 4
    },
    "moves": [
      {
        "name": "拔锋",
        "duration": 0.42,
        "contact": 0.442,
        "active": [
          0.3,
          0.62
        ],
        "damage": 22.17,
        "reach": 2.1,
        "shape": "arc",
        "halfAngle": 1.126,
        "width": 0.327,
        "lunge": 0.585,
        "knockback": 0.564,
        "hitstop": 0.043
      },
      {
        "name": "斜阳",
        "duration": 0.47,
        "contact": 0.492,
        "active": [
          0.335,
          0.645
        ],
        "damage": 24.83,
        "reach": 2.23,
        "shape": "arc",
        "halfAngle": 1.266,
        "width": 0.355,
        "lunge": 0.382,
        "knockback": 0.634,
        "hitstop": 0.046
      },
      {
        "name": "截流",
        "duration": 0.395,
        "contact": 0.392,
        "active": [
          0.37,
          0.67
        ],
        "damage": 19.95,
        "reach": 1.97,
        "shape": "thrust",
        "halfAngle": 0.31,
        "width": 0.34,
        "lunge": 0.701,
        "knockback": 0.704,
        "hitstop": 0.049
      },
      {
        "name": "归鞘",
        "duration": 0.596,
        "contact": 0.562,
        "active": [
          0.405,
          0.695
        ],
        "damage": 36.58,
        "reach": 2.42,
        "shape": "crush",
        "halfAngle": 1.176,
        "width": 0.411,
        "lunge": 0.481,
        "knockback": 0.774,
        "hitstop": 0.052
      }
    ]
  },
  {
    id: 'great-dao', name: '大刀', category: '重兵', grip: 'twohand',
    tagline: '腰带重刃，踏地破阵',
    description: '双手挥舞宽厚大刀，踏步转腰接连横扫、斜劈与回身大扫，最后以踏地重劈击退敌阵。蓄势沉稳，出刀迅猛，收势保留刀身惯性。',
    effectColor: 0xffad55, effectAccent: 0xffe6aa,
    stats: { speed: 4, power: 5, reach: 4 },
    moves: [
      {name:'踏步横扫',damage:32,knockback:.78,hitstop:.018,lunge:.42,recoverAt:.93},
      {name:'反向斜劈',damage:39,knockback:.96,hitstop:.020,lunge:.45,recoverAt:.93},
      {name:'回身大扫',damage:46,knockback:1.18,hitstop:.022,lunge:.48,recoverAt:.96},
      {name:'踏地重劈',damage:70,knockback:1.90,hitstop:.036,lunge:.55,recoverAt:.95},
    ],
  },
];
export const WEAPONS = WEAPON_TYPES;
const reviewedMoveNames = {
 'dual-dao':['右斜劈','左接斩','反手撩切','错锋双斩'],
 'tang-dao':['踏步斜斩','转胯横斩','提膝上撩','过顶落劈'],
 'great-dao':['踏步横扫','反向斜劈','回身大扫','踏地重劈'],
};
const reviewedDescriptions = {
 'tang-dao':'双手长柄直刃，踏步转胯带动斜斩、宽横斩、上撩与过顶落劈，以大幅刀路扫开前方敌阵。',
};
for(const weapon of WEAPONS){
  if(reviewedDescriptions[weapon.id]&&getReviewedAttack(weapon.id,0))weapon.description=reviewedDescriptions[weapon.id];
  weapon.moves.forEach((move,combo)=>{
    const action=getReviewedAttack(weapon.id,combo);
    if(!action)return;
    Object.assign(move,{name:reviewedMoveNames[weapon.id][combo],duration:action.duration,contact:action.contact,active:action.active,reach:action.reach,shape:action.kind==='thrust'?'thrust':['chop','smash'].includes(action.kind)?'crush':'arc',width:action.width,halfAngle:action.halfAngle??(weapon.id==='tang-dao'?1.6:action.kind==='thrust'?.28:.95),reviewed:true});
  });
}
const sourceNames = {
 'dual-dao':['交锋连斩','双锋回切','腾身撩刃','疾步破阵','双月旋杀'],
 'tang-dao':['转身横斩','反手撩切','踏步回斩','破阵直刺','腾身重斩'],
 'great-dao':['重刃开阵','回身撩刀','踏步大斩','蓄势突刺','腾身断阵'],
};
for (const weapon of WEAPONS) {
 if(['tang-dao','great-dao'].includes(weapon.id))weapon.grip='single';
 weapon.moves = createSourceWeaponMoves(weapon.id,weapon.moves).map((move,index)=>{
  const rule=getSourceAttackRule(weapon.id,index,weapon.id==='dual-dao'?-.01:.02);
  const start=Math.min(...rule.volumes.map(v=>v.delay+(v.type==='splash'?0:.05)));
  const end=Math.max(...rule.volumes.map(v=>v.delay+(v.type==='splash'?.2:.15)));
  return {...move,name:sourceNames[weapon.id][index],hitstop:0,
   contact:start/move.duration,active:[start/move.duration,end/move.duration],
   shape:rule.volumes.some(v=>v.type==='thrust')?'thrust':'arc'};
 });
 weapon.description='持械走跑随肩胯摆动，五式普攻由脚步、转腰、腾身与双臂共同发力，挥击与收势连续衔接。';
}
WEAPONS.push(HAMMER_WEAPON);
const weaponById = new Map(WEAPONS.map(weapon => [weapon.id, weapon]));
export function getWeapon(id) { return weaponById.get(id) || weaponById.get(DEFAULT_WEAPON_ID); }

// Two weapon types share their authored motion and combat timings.
import { getReviewedAttack } from './choreography/index.js';
export const DEFAULT_WEAPON_ID = 'dual-dao';
export const UNLOCKED_WEAPON_IDS = new Set(['dual-dao', 'tang-dao']);
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
  }
];
export const WEAPONS = WEAPON_TYPES;
const reviewedMoveNames = {
 'dual-dao':['右斜劈','左接斩','反手撩切','错锋双斩'],
 'tang-dao':['踏步斜斩','转胯横斩','提膝上撩','过顶落劈'],
};
const reviewedDescriptions = {
 'tang-dao':'双手长柄直刃，踏步转胯带动斜斩、宽横斩、上撩与过顶落劈，以大幅刀路扫开前方敌阵。',
};
for(const weapon of WEAPONS){
  if(reviewedDescriptions[weapon.id]&&getReviewedAttack(weapon.id,0))weapon.description=reviewedDescriptions[weapon.id];
  weapon.moves.forEach((move,combo)=>{
    const action=getReviewedAttack(weapon.id,combo);
    if(!action)return;
    Object.assign(move,{name:reviewedMoveNames[weapon.id][combo],duration:action.duration,contact:action.contact,active:action.active,reach:action.reach,shape:action.kind==='thrust'?'thrust':action.kind==='chop'?'crush':'arc',width:action.width,halfAngle:action.halfAngle??(weapon.id==='tang-dao'?1.6:action.kind==='thrust'?.28:.95),reviewed:true});
  });
}
const weaponById = new Map(WEAPONS.map(weapon => [weapon.id, weapon]));
export function getWeapon(id) { return weaponById.get(id) || weaponById.get(DEFAULT_WEAPON_ID); }

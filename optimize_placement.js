#!/usr/bin/env node
"use strict";

/*
 * Offline adversarial placement optimizer.
 *
 * It approximates a zero-sum placement game:
 *   defender action  = choose a legal complete fleet layout
 *   attacker policy  = one seeded instance of Probability/Bayesian/POMCP or
 *                      a deterministic human-style hunt/target policy
 *   payoff           = shots required to sink the fleet (larger is better)
 *
 * The script evolves a large candidate set, evaluates finalists against the
 * attack ensemble, then solves a linear program for a maximin mixed strategy.
 * Constraints keep any one layout from receiving too much probability and
 * keep the aggregate cell-occupancy prior close to flat so a knowledgeable
 * repeat opponent cannot exploit a small set of hot cells.
 *
 * Usage:
 *   node optimize_placement.js --mode=quick
 *   node optimize_placement.js --mode=full --output=layouts.json
 */

const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");
const { spawnSync } = require("child_process");
const path = require("path");

const args = Object.fromEntries(process.argv.slice(2).map((x) => {
  const [k, ...rest] = x.replace(/^--/, "").split("=");
  return [k, rest.length ? rest.join("=") : true];
}));
const MODE = String(args.mode || "quick");
const OUTPUT = path.resolve(args.output || path.join(__dirname, "layouts.json"));
const AI_FILE = path.resolve(args.ai || path.join(__dirname, "ai.js"));
const EXISTING = path.resolve(args.seedLayouts || path.join(__dirname, "layouts.json"));

const cfg = MODE === "full" ? {
  randomCandidates: 3000,
  mutantCandidates: 6000,
  fastKeep: 500,
  secondMutants: 3000,
  finalKeep: 280,
  probSeeds: [101, 211, 307, 401, 503, 601],
  bayesSeeds: [701, 809, 907],
  pomcpSeeds: [1009, 1103, 1201, 1301],
  maxWeight: 0.04,
  occupancyLow: 0.145,
  occupancyHigh: 0.225,
} : {
  randomCandidates: 900,
  mutantCandidates: 1600,
  fastKeep: 180,
  secondMutants: 700,
  finalKeep: 100,
  probSeeds: [101, 307, 503],
  bayesSeeds: [701],
  pomcpSeeds: [1009, 1201],
  maxWeight: 0.07,
  occupancyLow: 0.13,
  occupancyHigh: 0.245,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(123456789);
function reseed(seed) { rng = mulberry32(seed); }
function rand() { return rng(); }
function randInt(n) { return Math.floor(rand() * n); }
function pick(arr) { return arr[randInt(arr.length)]; }
function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Load browser AI code into a deterministic VM. Every seeded evaluation resets
// the shared Math.random used by the AI classes.
const mathObject = Object.create(Math);
mathObject.random = () => rand();
const source = fs.readFileSync(AI_FILE, "utf8") + `\n;globalThis.__PLACEMENT_EXPORTS__={ROWS,COLS,STANDARD_FLEET_SIZES,key,shipCells,makeEmptyBoard,ProbabilityAI,BayesianAI,POMCPAI,PlacementAI};`;
const context = { console, performance, Math: mathObject, BigInt, Set, Map, Array, Object, Number, String, Error, JSON, fetch: global.fetch };
vm.createContext(context);
vm.runInContext(source, context, { filename: AI_FILE });
const AI = context.__PLACEMENT_EXPORTS__;
const { ROWS, COLS } = AI;
const FLEET = [...AI.STANDARD_FLEET_SIZES];
const CELL_COUNT = ROWS * COLS;
const TARGET_OCCUPANCY = FLEET.reduce((a, b) => a + b, 0) / CELL_COUNT;

function cellsOf(ship) { return AI.shipCells(ship.r, ship.c, ship.length, ship.orientation); }
function normalized(layout) {
  return [...layout]
    .map((s) => ({ r: s.r, c: s.c, length: s.length, orientation: s.orientation }))
    .sort((a, b) => b.length - a.length || a.r - b.r || a.c - b.c || a.orientation.localeCompare(b.orientation));
}
function canonical(layout) { return normalized(layout).map((s) => `${s.length}${s.orientation}${s.r},${s.c}`).join("|"); }
function legal(layout) {
  if (!Array.isArray(layout) || layout.length !== FLEET.length) return false;
  const lengths = layout.map((s) => s.length).sort((a, b) => a - b).join(",");
  if (lengths !== [...FLEET].sort((a, b) => a - b).join(",")) return false;
  const occupied = new Set();
  for (const s of layout) {
    const cells = cellsOf(s);
    if (cells.some(([r, c]) => r < 0 || r >= ROWS || c < 0 || c >= COLS)) return false;
    for (const [r, c] of cells) {
      const k = `${r},${c}`;
      if (occupied.has(k)) return false;
      occupied.add(k);
    }
  }
  return occupied.size === 17;
}
function occupiedIndices(layout) {
  const out = [];
  for (const s of layout) for (const [r, c] of cellsOf(s)) out.push(r * COLS + c);
  return out.sort((a, b) => a - b);
}
function toRaw(layout) { return normalized(layout).map((s) => [s.r, s.c, s.length, s.orientation]); }
function fromRaw(raw) { return normalized(raw.map(([r, c, length, orientation]) => ({ r, c, length, orientation }))); }

function transform(layout, hFlip, vFlip) {
  return normalized(layout.map((s) => {
    let { r, c, length, orientation } = s;
    if (hFlip) c = orientation === "H" ? COLS - c - length : COLS - 1 - c;
    if (vFlip) r = orientation === "V" ? ROWS - r - length : ROWS - 1 - r;
    return { r, c, length, orientation };
  }));
}

function randomLayout() {
  const occupied = new Set();
  const out = [];
  for (const length of [...FLEET].sort((a, b) => b - a)) {
    let placed = false;
    for (let tries = 0; tries < 1000 && !placed; tries++) {
      const orientation = rand() < 0.5 ? "H" : "V";
      const r = orientation === "H" ? randInt(ROWS) : randInt(ROWS - length + 1);
      const c = orientation === "H" ? randInt(COLS - length + 1) : randInt(COLS);
      const s = { r, c, length, orientation };
      const cells = cellsOf(s);
      if (cells.some(([rr, cc]) => occupied.has(`${rr},${cc}`))) continue;
      for (const [rr, cc] of cells) occupied.add(`${rr},${cc}`);
      out.push(s);
      placed = true;
    }
    if (!placed) return randomLayout();
  }
  return normalized(out);
}

function mutate(layout) {
  let out = normalized(layout).map((s) => ({ ...s }));
  const operations = 1 + (rand() < 0.28 ? 1 : 0) + (rand() < 0.08 ? 1 : 0);
  for (let op = 0; op < operations; op++) {
    const idx = randInt(out.length);
    const original = { ...out[idx] };
    const mode = randInt(6);
    let candidate = null;
    if (mode === 0) {
      // Fully relocate one ship.
      const orientation = rand() < 0.5 ? "H" : "V";
      candidate = {
        ...original,
        orientation,
        r: orientation === "H" ? randInt(ROWS) : randInt(ROWS - original.length + 1),
        c: orientation === "H" ? randInt(COLS - original.length + 1) : randInt(COLS),
      };
    } else if (mode === 1) {
      // Shift by one or two cells.
      candidate = { ...original, r: original.r + pick([-2, -1, 1, 2]), c: original.c };
      if (rand() < 0.5) candidate = { ...original, r: original.r, c: original.c + pick([-2, -1, 1, 2]) };
    } else if (mode === 2) {
      // Rotate and choose a nearby legal anchor.
      const orientation = original.orientation === "H" ? "V" : "H";
      candidate = { ...original, orientation, r: original.r + pick([-1, 0, 1]), c: original.c + pick([-1, 0, 1]) };
    } else if (mode === 3) {
      // Deliberately move toward an edge/corner.
      const orientation = rand() < 0.5 ? "H" : "V";
      const edgeR = rand() < 0.5 ? 0 : (orientation === "V" ? ROWS - original.length : ROWS - 1);
      const edgeC = rand() < 0.5 ? 0 : (orientation === "H" ? COLS - original.length : COLS - 1);
      candidate = { ...original, orientation, r: rand() < 0.5 ? edgeR : (orientation === "H" ? randInt(ROWS) : randInt(ROWS - original.length + 1)), c: rand() < 0.5 ? edgeC : (orientation === "H" ? randInt(COLS - original.length + 1) : randInt(COLS)) };
    } else if (mode === 4) {
      // Move near another ship, allowing touching but never overlap.
      const other = out[(idx + 1 + randInt(out.length - 1)) % out.length];
      const orientation = rand() < 0.5 ? "H" : "V";
      candidate = { ...original, orientation, r: other.r + pick([-2, -1, 0, 1, 2]), c: other.c + pick([-2, -1, 0, 1, 2]) };
    } else {
      // Mirror only one ship; useful for escaping a local family.
      candidate = { ...original };
      if (rand() < 0.5) candidate.c = candidate.orientation === "H" ? COLS - candidate.c - candidate.length : COLS - 1 - candidate.c;
      else candidate.r = candidate.orientation === "V" ? ROWS - candidate.r - candidate.length : ROWS - 1 - candidate.r;
    }
    out[idx] = candidate;
    if (!legal(out)) out[idx] = original;
  }
  if (rand() < 0.12) out = transform(out, rand() < 0.5, rand() < 0.5);
  return normalized(out);
}

function withCells(layout) { return layout.map((s) => ({ ...s, cells: cellsOf(s) })); }
function shipSet(layout) {
  const set = new Set();
  for (const s of layout) for (const [r, c] of s.cells) set.add(`${r},${c}`);
  return set;
}
function isSunk(ship, board) { return ship.cells.every(([r, c]) => board[r][c] === "hit"); }

function play(factory, rawLayout, seed) {
  reseed(seed);
  const layout = withCells(rawLayout);
  const ships = shipSet(layout);
  const board = AI.makeEmptyBoard();
  const ai = factory();
  let remaining = ships.size;
  let shots = 0;
  while (remaining > 0 && shots < CELL_COUNT) {
    const [r, c] = ai.selectNextMove(board);
    if (board[r][c] !== null) throw new Error(`${ai.constructor.name} repeated ${r},${c}`);
    const hit = ships.has(`${r},${c}`);
    const struck = hit ? layout.find((s) => s.cells.some(([rr, cc]) => rr === r && cc === c)) : null;
    board[r][c] = hit ? "hit" : "miss";
    shots++;
    if (hit) remaining--;
    const sunk = struck && isSunk(struck, board) ? struck : null;
    if (typeof ai.recordShotResult === "function") {
      ai.recordShotResult({ row: r, col: c, hit, sunkLength: sunk ? sunk.length : null, sunkCells: sunk ? sunk.cells : null });
    }
  }
  return shots;
}

class HumanHuntAI {
  constructor(order) {
    this.order = order;
    this.resolved = new Set();
  }
  recordShotResult({ sunkCells = null } = {}) {
    if (Array.isArray(sunkCells)) for (const [r, c] of sunkCells) this.resolved.add(`${r},${c}`);
  }
  selectNextMove(board) {
    const active = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (board[r][c] === "hit" && !this.resolved.has(`${r},${c}`)) active.push([r, c]);
    }
    if (active.length) {
      const activeSet = new Set(active.map(([r, c]) => `${r},${c}`));
      const candidates = new Map();
      for (const [r, c] of active) {
        for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const rr=r+dr, cc=c+dc;
          if (rr<0||rr>=ROWS||cc<0||cc>=COLS||board[rr][cc]!==null) continue;
          let score=2;
          if (activeSet.has(`${r-dr},${c-dc}`)) score += 8; // extend an aligned run
          candidates.set(`${rr},${cc}`, Math.max(candidates.get(`${rr},${cc}`)||0, score));
        }
      }
      if (candidates.size) {
        let best=-1, bestCells=[];
        for (const [k,s] of candidates) {
          const [r,c]=k.split(",").map(Number);
          if(s>best){best=s;bestCells=[[r,c]];}else if(s===best)bestCells.push([r,c]);
        }
        return pick(bestCells);
      }
    }
    for (const idx of this.order) {
      const r=Math.floor(idx/COLS), c=idx%COLS;
      if(board[r][c]===null)return [r,c];
    }
    throw new Error("No legal move");
  }
}

function initialDensityOrder(parity = null, reverse = false) {
  const score = new Array(CELL_COUNT).fill(0);
  for (const len of FLEET) {
    for (let r=0;r<ROWS;r++)for(let c=0;c<=COLS-len;c++)for(let i=0;i<len;i++)score[r*COLS+c+i]++;
    for (let r=0;r<=ROWS-len;r++)for(let c=0;c<COLS;c++)for(let i=0;i<len;i++)score[(r+i)*COLS+c]++;
  }
  return Array.from({length:CELL_COUNT},(_,i)=>i).sort((a,b)=>{
    const ar=Math.floor(a/COLS), ac=a%COLS, br=Math.floor(b/COLS), bc=b%COLS;
    if(parity!==null){const ap=((ar+ac)&1)===parity?1:0,bp=((br+bc)&1)===parity?1:0;if(ap!==bp)return bp-ap;}
    const d=reverse?score[a]-score[b]:score[b]-score[a];
    if(d)return d;
    return a-b;
  });
}
function spiralOrder() {
  const cells=Array.from({length:CELL_COUNT},(_,i)=>i);
  const cr=(ROWS-1)/2, cc=(COLS-1)/2;
  return cells.sort((a,b)=>{
    const ar=Math.floor(a/COLS),ac=a%COLS,br=Math.floor(b/COLS),bc=b%COLS;
    const da=Math.max(Math.abs(ar-cr),Math.abs(ac-cc)), db=Math.max(Math.abs(br-cr),Math.abs(bc-cc));
    return da-db || a-b;
  });
}
function rowSnakeOrder() {
  const out=[]; for(let r=0;r<ROWS;r++){const cs=Array.from({length:COLS},(_,c)=>c);if(r&1)cs.reverse();for(const c of cs)out.push(r*COLS+c);}return out;
}
const HUMAN_ORDERS = [initialDensityOrder(null,false), initialDensityOrder(0,false), initialDensityOrder(1,false), initialDensityOrder(null,true), spiralOrder(), rowSnakeOrder()];

function quantile(values, q) {
  const a=[...values].sort((x,y)=>x-y); return a[Math.max(0,Math.min(a.length-1,Math.floor(q*(a.length-1))))];
}
function fastEvaluate(layout) {
  const values=[];
  for(const seed of [17,31,47]) values.push(play(()=>new AI.ProbabilityAI(FLEET),layout,seed));
  for(let i=0;i<HUMAN_ORDERS.length;i++) values.push(play(()=>new HumanHuntAI(HUMAN_ORDERS[i]),layout,100+i));
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const low=quantile(values,0.15);
  return { fastScore:0.62*mean+0.38*low, fastMean:mean, fastLow:low, fastValues:values };
}
function fullEvaluate(layout) {
  const payoffs={};
  for(const seed of cfg.probSeeds) payoffs[`prob-${seed}`]=play(()=>new AI.ProbabilityAI(FLEET),layout,seed);
  for(const seed of cfg.bayesSeeds) payoffs[`bayes-${seed}`]=play(()=>new AI.BayesianAI(FLEET,{particles:260,minParticles:40,resampleBudgetMs:10,poolPickAttempts:14}),layout,seed);
  for(const seed of cfg.pomcpSeeds) payoffs[`pomcp-${seed}`]=play(()=>AI.POMCPAI.benchmark(FLEET),layout,seed);
  for(let i=0;i<HUMAN_ORDERS.length;i++) payoffs[`human-${i}`]=play(()=>new HumanHuntAI(HUMAN_ORDERS[i]),layout,4000+i);
  const vals=Object.values(payoffs);
  const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
  const low=quantile(vals,0.12);
  const pom=Object.entries(payoffs).filter(([k])=>k.startsWith("pomcp")).map(([,v])=>v);
  const bay=Object.entries(payoffs).filter(([k])=>k.startsWith("bayes")).map(([,v])=>v);
  const strongMean=[...pom,...bay].reduce((a,b)=>a+b,0)/(pom.length+bay.length);
  return {payoffs,mean,low,strongMean,robustScore:0.35*mean+0.35*strongMean+0.30*low};
}

function addUnique(map, layout) { if (legal(layout)) map.set(canonical(layout), normalized(layout)); }
function readExisting() {
  try {
    const d=JSON.parse(fs.readFileSync(EXISTING,"utf8"));
    return (d.layouts||[]).map((item)=>fromRaw(Array.isArray(item)?item:(item.layout||[]))).filter(legal);
  } catch { return []; }
}

function collectCandidates() {
  const all=new Map();
  const seeds=readExisting();
  for(const l of seeds) for(const [h,v] of [[false,false],[true,false],[false,true],[true,true]]) addUnique(all,transform(l,h,v));
  while(all.size<seeds.length*4+cfg.randomCandidates) addUnique(all,randomLayout());
  const bases=[...all.values()];
  for(let i=0;i<cfg.mutantCandidates;i++) addUnique(all,mutate(pick(bases)));
  return [...all.values()];
}

function screen(candidates, keep) {
  const evaluated=[]; const started=performance.now();
  for(let i=0;i<candidates.length;i++){
    const r=fastEvaluate(candidates[i]); evaluated.push({layout:candidates[i],...r});
    if((i+1)%200===0) console.log(`fast ${i+1}/${candidates.length} (${((performance.now()-started)/1000).toFixed(1)}s)`);
  }
  evaluated.sort((a,b)=>b.fastScore-a.fastScore);
  return evaluated.slice(0,keep);
}

function similarity(a,b){
  const A=new Set(occupiedIndices(a)); let overlap=0;for(const x of occupiedIndices(b))if(A.has(x))overlap++;return overlap/17;
}
function diverseTop(records, n, penalty=5.0){
  const chosen=[];const remaining=[...records];
  while(chosen.length<n&&remaining.length){
    let bestIdx=0,best=-Infinity;
    for(let i=0;i<remaining.length;i++){
      const sim=chosen.length?Math.max(...chosen.map(c=>similarity(c.layout,remaining[i].layout))):0;
      const value=remaining[i].robustScore-penalty*sim;
      if(value>best){best=value;bestIdx=i;}
    }
    chosen.push(remaining.splice(bestIdx,1)[0]);
  }
  return chosen;
}

function solveMixture(records) {
  const matrix = records.map((r)=>r.payoffs);
  const policyNames=[...new Set(matrix.flatMap(Object.keys))].sort();
  const payload={
    maxWeight:cfg.maxWeight, occupancyLow:cfg.occupancyLow, occupancyHigh:cfg.occupancyHigh,
    targetOccupancy:TARGET_OCCUPANCY,
    layouts:records.map((r)=>({cells:occupiedIndices(r.layout),payoffs:policyNames.map((p)=>r.payoffs[p]??r.mean)})),
    policies:policyNames,
  };
  const py=`
import json,sys,numpy as np
from scipy.optimize import linprog
x=json.load(sys.stdin); L=x['layouts']; n=len(L); m=len(x['policies']); C=${CELL_COUNT}
# variables w_0...w_(n-1), v
c=np.zeros(n+1); c[-1]=-1
A=[]; b=[]
# expected payoff for every attack policy >= v
for j in range(m):
 row=np.zeros(n+1)
 for i,l in enumerate(L): row[i]=-l['payoffs'][j]
 row[-1]=1
 A.append(row); b.append(0)
# occupancy upper/lower bounds
for cell in range(C):
 row=np.zeros(n+1)
 for i,l in enumerate(L): row[i]=1 if cell in l['cells'] else 0
 A.append(row); b.append(x['occupancyHigh'])
 A.append(-row); b.append(-x['occupancyLow'])
Aeq=np.zeros((1,n+1)); Aeq[0,:n]=1; beq=np.array([1.0])
bounds=[(0,x['maxWeight'])]*n+[(None,None)]
res=linprog(c,A_ub=np.array(A),b_ub=np.array(b),A_eq=Aeq,b_eq=beq,bounds=bounds,method='highs')
if not res.success:
 # Relax cell lower bound first, while preserving maximin and concentration controls.
 A=[];b=[]
 for j in range(m):
  row=np.zeros(n+1)
  for i,l in enumerate(L): row[i]=-l['payoffs'][j]
  row[-1]=1;A.append(row);b.append(0)
 for cell in range(C):
  row=np.zeros(n+1)
  for i,l in enumerate(L): row[i]=1 if cell in l['cells'] else 0
  A.append(row);b.append(max(x['occupancyHigh'],0.25))
 res=linprog(c,A_ub=np.array(A),b_ub=np.array(b),A_eq=Aeq,b_eq=beq,bounds=bounds,method='highs')
if not res.success:
 print(json.dumps({'success':False,'message':res.message}));sys.exit(0)
w=res.x[:n]; occ=[]
for cell in range(C): occ.append(sum(w[i] for i,l in enumerate(L) if cell in l['cells']))
print(json.dumps({'success':True,'value':res.x[-1],'weights':w.tolist(),'occupancy':occ,'message':res.message}))
`;
  const out=spawnSync("python",["-c",py],{input:JSON.stringify(payload),encoding:"utf8",maxBuffer:20*1024*1024});
  if(out.status!==0) throw new Error(out.stderr||"LP failed");
  const result=JSON.parse(out.stdout);
  if(!result.success) throw new Error(result.message);
  return {...result,policyNames};
}

function summarize(records, weights) {
  const policies=Object.keys(records[0].payoffs);
  const exp={}; for(const p of policies)exp[p]=0;
  records.forEach((r,i)=>{for(const p of policies)exp[p]+=weights[i]*(r.payoffs[p]??0);});
  const groups={prob:[],bayes:[],pomcp:[],human:[]};
  for(const [k,v] of Object.entries(exp)){const g=k.split("-")[0];if(groups[g])groups[g].push(v);}
  const means=Object.fromEntries(Object.entries(groups).map(([k,a])=>[k,a.length?a.reduce((x,y)=>x+y,0)/a.length:null]));
  return {expectedByPolicy:exp,expectedGroupMeans:means,minExpected:Math.min(...Object.values(exp))};
}

function main(){
  console.log(`mode=${MODE} target occupancy=${TARGET_OCCUPANCY.toFixed(4)}`);
  const initial=collectCandidates();
  console.log(`candidate layouts: ${initial.length}`);
  let screened=screen(initial,cfg.fastKeep);
  console.log(`first screen best=${screened[0].fastScore.toFixed(2)} median-kept=${screened[Math.floor(screened.length/2)].fastScore.toFixed(2)}`);

  const second=new Map();
  for(const x of screened)addUnique(second,x.layout);
  for(let i=0;i<cfg.secondMutants;i++)addUnique(second,mutate(pick(screened).layout));
  screened=screen([...second.values()],cfg.finalKeep);
  console.log(`second screen best=${screened[0].fastScore.toFixed(2)} candidates=${screened.length}`);

  const full=[];const t=performance.now();
  for(let i=0;i<screened.length;i++){
    const f=fullEvaluate(screened[i].layout);full.push({layout:screened[i].layout,...screened[i],...f});
    if((i+1)%10===0)console.log(`full ${i+1}/${screened.length} (${((performance.now()-t)/1000).toFixed(1)}s)`);
  }
  full.sort((a,b)=>b.robustScore-a.robustScore);
  const diverse=diverseTop(full,Math.min(full.length,MODE==="full"?220:90),4.0);
  // Add all legal symmetries of finalists before the LP, which improves
  // marginal coverage and prevents the support from having a directional bias.
  const expanded=new Map();
  const byCanon=new Map(full.map(r=>[canonical(r.layout),r]));
  for(const r of diverse){
    for(const [h,v] of [[false,false],[true,false],[false,true],[true,true]]){
      const l=transform(r.layout,h,v); const k=canonical(l);
      if(!expanded.has(k)) expanded.set(k,l);
    }
  }
  const finalRecords=[];
  const expandedList=[...expanded.values()];
  console.log(`LP candidates including symmetries: ${expandedList.length}`);
  for(let i=0;i<expandedList.length;i++){
    const k=canonical(expandedList[i]);
    if(byCanon.has(k))finalRecords.push(byCanon.get(k));
    else finalRecords.push({layout:expandedList[i],...fastEvaluate(expandedList[i]),...fullEvaluate(expandedList[i])});
    if((i+1)%20===0)console.log(`expanded evaluation ${i+1}/${expandedList.length}`);
  }
  const mixture=solveMixture(finalRecords);
  const support=finalRecords.map((r,i)=>({r,w:mixture.weights[i]})).filter(x=>x.w>1e-8).sort((a,b)=>b.w-a.w);
  const selected=support.map(x=>x.r);
  const weights=support.map(x=>x.w);
  const sum=weights.reduce((a,b)=>a+b,0);for(let i=0;i<weights.length;i++)weights[i]/=sum;
  const occ=new Array(CELL_COUNT).fill(0);selected.forEach((r,i)=>{for(const c of occupiedIndices(r.layout))occ[c]+=weights[i];});
  const summary=summarize(selected,weights);
  const data={
    schema:2,
    board:{rows:ROWS,cols:COLS},fleet:FLEET,
    generated:new Date().toISOString(),
    method:"adversarial evolutionary search + finite-game maximin linear program",
    mode:MODE,
    count:selected.length,
    target_cell_occupancy:TARGET_OCCUPANCY,
    occupancy:{min:Math.min(...occ),max:Math.max(...occ),mean:occ.reduce((a,b)=>a+b,0)/occ.length},
    maximin_value:mixture.value,
    expected_group_means:summary.expectedGroupMeans,
    layouts:selected.map((r,i)=>({
      id:`adv-${String(i+1).padStart(3,"0")}`,
      weight:weights[i],
      robust_score:r.robustScore,
      expected_shots:r.mean,
      worst_policy_shots:Math.min(...Object.values(r.payoffs)),
      layout:toRaw(r.layout),
    })),
  };
  fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2)+"\n");
  console.log(`wrote ${OUTPUT}`);
  console.log(`support=${data.count} maximin=${data.maximin_value.toFixed(3)} occupancy=${data.occupancy.min.toFixed(3)}..${data.occupancy.max.toFixed(3)}`);
  console.log("group expected shots",data.expected_group_means);
}

main();

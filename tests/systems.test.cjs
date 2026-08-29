// Unit tests for lib/systems.ts computeSystems.
// Runs against a CommonJS build emitted by `pnpm test` into .test-dist/.
const { computeSystems, isMemoryUnlocked, memoryTierOf, affinityLevelOf } = require("../.test-dist/systems.js");
const assert = require("node:assert");

const CAST = [
  { id: "cast-a", name: "陈姐", role: "老板", attribute: "career" },
  { id: "cast-b", name: "小周", role: "同事", attribute: "relationship" },
  { id: "cast-c", name: "罗琳", role: "leader", attribute: "intimacy" },
];
const LOCATIONS = [
  { id: "loc-a", name: "咖啡厅", category: "happiness" },
  { id: "loc-h", name: "天台", category: "courage", requires: { characterId: "cast-a", affinityLevel: "trusted" } },
  { id: "loc-u", name: "秘密基地", category: "courage", ultimate: true },
];
const run = (choices) => ({ choices, cast: CAST, locations: LOCATIONS });
const choice = (deltas, extra = {}) => ({ nodeId: "n", choiceId: "c", choiceLabel: "x", memory: "m", deltas, at: Date.now() + Math.random(), ...extra });

// A: attributes only grow, cap at 100, legacy negatives are no-ops
{
  const s = computeSystems(run([choice({ career: 120 }), choice({ career: -50, happiness: 5 })]));
  assert.strictEqual(s.attributes.career, 100, "cap at 100");
  assert.strictEqual(s.attributes.happiness, 5, "positive still applies");
  console.log("A attributes grow/cap OK");
}

// B: affinity multiplier × cap, level-up 反哺 +3, 回忆碎片 on each tier crossing
{
  const seq = Array.from({ length: 12 }, (_, i) => choice({}, { affinity: { characterId: "cast-a", amount: 5 }, nodeChapter: Math.floor(i / 6) + 1 }));
  const s = computeSystems(run(seq));
  assert.strictEqual(s.affinity["cast-a"].value, 60, "capped at 60");
  assert.strictEqual(s.affinity["cast-a"].level, "trusted", "level trusted");
  assert.strictEqual(s.attributes.career, 9, "反哺 3× +3");
  assert.strictEqual(s.fragments.filter((f) => f.type === "memory").length, 3, "3 memory fragments");
  console.log("B affinity/反哺/回忆碎片 OK");
}

// C: story fragment from choice + fate fragments at thresholds
{
  const s = computeSystems(run([
    choice({ courage: 40 }, { fragment: { name: "碎片·a", text: "x".repeat(40) } }),
    choice({ intimacy: 70 }),
    choice({ relationship: 50 }),
  ]));
  const types = s.fragments.map((f) => f.type).sort();
  assert.deepStrictEqual(types, ["fate", "fate", "fate", "story"], "story + 3 fate fragments");
  assert(s.fragments.some((f) => f.name === "命运碎片·突破" && f.type === "fate"));
  assert(s.fragments.some((f) => f.name === "命运碎片·觉醒"));
  assert(s.fragments.some((f) => f.name === "命运碎片·羁绊"));
  console.log("C story + fate fragments OK");
}

// D: location unlock — base threshold, compound requires, ultimate
{
  const base = computeSystems(run([choice({ happiness: 35 })]));
  assert.strictEqual(base.locations["loc-a"].unlocked, true, "base category unlock");
  assert.strictEqual(base.locations["loc-h"].unlocked, false, "compound still locked");
  assert.strictEqual(base.locations["loc-u"].unlocked, false, "ultimate still locked");
  const seq = [
    choice({ happiness: 35 }),
    ...Array.from({ length: 12 }, (_, i) => choice({}, { affinity: { characterId: "cast-a", amount: 5 } })),
    choice({ career: 70, courage: 70, relationship: 70, intimacy: 70, happiness: 70 }),
  ];
  const full = computeSystems(run(seq));
  assert.strictEqual(full.affinity["cast-a"].level, "trusted", "trusted reached");
  assert.strictEqual(full.locations["loc-h"].unlocked, true, "compound unlocked after trusted");
  assert.strictEqual(full.locations["loc-u"].unlocked, true, "ultimate unlocked");
  console.log("D location unlock OK");
}

// E: achievements + rewards + 集齐3称号全属性+3
{
  const seq = [
    ...Array.from({ length: 8 }, (_, i) => choice({ career: 12 }, { fragment: { name: `碎片·${i}`, text: "y".repeat(40) } })),
    choice({ relationship: 70, intimacy: 60 }),
  ];
  const s = computeSystems(run(seq));
  assert.strictEqual(s.attributes.career, 100, "career-peak reward capped");
  assert(s.achievements.includes("career-peak"), "career-peak");
  assert(s.achievements.includes("memory-keeper"), "memory-keeper");
  assert(s.achievements.includes("socialite"), "socialite");
  assert.strictEqual(s.attributes.happiness, 8, "memory-keeper +5 then all-attr +3");
  assert.strictEqual(s.attributes.relationship, 78, "socialite +5 then all-attr +3");
  assert.strictEqual(s.attributes.courage, 3, "all-attr +3 applied to untouched");
  console.log("E achievements + rewards OK");
}

// F: rewind consistency — truncating choices recomputes to an earlier state
{
  const full = computeSystems(run([choice({ career: 10 }), choice({ career: 20 }), choice({ career: 30 })]));
  const rewound = computeSystems(run([choice({ career: 10 }), choice({ career: 20 })]));
  assert.strictEqual(full.attributes.career, 60);
  assert.strictEqual(rewound.attributes.career, 30, "rewind recomputes");
  console.log("F rewind consistency OK");
}

// G: helpers
{
  assert.strictEqual(affinityLevelOf(59).label, "熟悉");
  assert.strictEqual(affinityLevelOf(60).level, "trusted");
  assert.strictEqual(memoryTierOf(29).label, "简略追忆");
  assert.strictEqual(memoryTierOf(90).tier, "perfect");
  const plan = { chapters: 5, items: [{ chapter: 1, title: "t", synopsis: "s", characterId: "cast-a" }] };
  const frags = Array.from({ length: 3 }, (_, i) => choice({}, { fragment: { name: "f", text: "z".repeat(40) }, nodeChapter: 1 }));
  const unlocked = isMemoryUnlocked({ choices: frags, cast: CAST, plan }, 1);
  assert.strictEqual(unlocked.unlocked, false, "not trusted yet");
  const trustedChoices = [...frags, ...Array.from({ length: 12 }, () => choice({}, { affinity: { characterId: "cast-a", amount: 5 } }))];
  const ok = isMemoryUnlocked({ choices: trustedChoices, cast: CAST, plan }, 1);
  assert.strictEqual(ok.unlocked, true, "trusted + 3 fragments → memory unlocked");
  console.log("G helpers + memory unlock OK");
}

console.log("\nALL SYSTEMS TESTS PASSED");

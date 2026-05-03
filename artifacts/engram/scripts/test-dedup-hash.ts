#!/usr/bin/env node
// Unit test: lib/hash.ts — proves Gemini/Claude UI noise no longer poisons the
// dedup hash. Two captures of the SAME conversation, with realistic Gemini
// button noise sprinkled in different positions on each capture, must produce
// IDENTICAL content_hash and identity_hash. Otherwise dedup fails and the
// dashboard fills up with near-duplicates (the bug the user reported).

import { hashConversation, hashConversationIdentity } from "../lib/hash";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string, extra = "") {
  if (cond) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${extra ? "  — " + extra : ""}`);
    failed++;
  }
}

// Capture 1 of a Gemini chat (noise interleaved one way)
const cap1 = [
  {
    role: "user",
    content: "Explain recursion in Python with a factorial example.",
  },
  {
    role: "assistant",
    content:
      "Recursion is when a function calls itself.\n\n" +
      "```python\ndef factorial(n):\n  return 1 if n <= 1 else n * factorial(n-1)\n```\n\n" +
      "thumb_up\nthumb_down\nvolume_up\nshare\nCopy\nedit\nmore_vert",
  },
];

// Capture 2: same conversation, Gemini re-rendered with noise in a slightly
// different order + extra whitespace + a "Show drafts" affordance
const cap2 = [
  {
    role: "user",
    content: "Explain recursion in Python with a factorial example.   ",
  },
  {
    role: "assistant",
    content:
      "Show drafts\n\n" +
      "Recursion is when a function calls itself.\n\n" +
      "```python\ndef factorial(n):\n  return 1 if n <= 1 else n * factorial(n-1)\n```\n\n" +
      "Good response\nBad response\nvolume_up\ncopy\nregenerate",
  },
];

// Capture 3: SAME identity but conversation grew (3rd pair appended). Identity
// hash must still match cap1/cap2; content hash must differ.
const cap3 = [
  ...cap2,
  { role: "user", content: "Now do it iteratively." },
  {
    role: "assistant",
    content:
      "```python\ndef factorial(n):\n  r = 1\n  for i in range(2, n+1): r *= i\n  return r\n```",
  },
];

// Capture 4: TRULY different conversation — both hashes must differ
const cap4 = [
  { role: "user", content: "What's the capital of France?" },
  { role: "assistant", content: "Paris." },
];

console.log("\n🧪 lib/hash.ts dedup robustness\n");

const c1 = hashConversation(cap1);
const c2 = hashConversation(cap2);
const c3 = hashConversation(cap3);
const c4 = hashConversation(cap4);

const i1 = hashConversationIdentity(cap1);
const i2 = hashConversationIdentity(cap2);
const i3 = hashConversationIdentity(cap3);
const i4 = hashConversationIdentity(cap4);

assert(
  c1 === c2,
  "content_hash matches across UI-noise variants of same chat",
  `cap1=${c1.slice(0, 12)} cap2=${c2.slice(0, 12)}`
);
assert(
  i1 === i2,
  "identity_hash matches across UI-noise variants of same chat",
  `cap1=${i1.slice(0, 12)} cap2=${i2.slice(0, 12)}`
);
assert(
  c1 !== c3,
  "content_hash DIFFERS when conversation grew (so we know to update)"
);
assert(
  i1 === i3,
  "identity_hash STAYS THE SAME when conversation grew (so we update in place)",
  `cap1=${i1.slice(0, 12)} cap3=${i3.slice(0, 12)}`
);
assert(c1 !== c4, "content_hash differs for unrelated conversation");
assert(i1 !== i4, "identity_hash differs for unrelated conversation");

// Empty / edge cases
assert(hashConversationIdentity([]) === "", "identity_hash('') = empty string");
assert(hashConversation([]) !== "", "content_hash([]) is still a deterministic hash");

console.log(
  `\nResult: ${passed} passed, ${failed} failed${failed ? " ❌" : " ✅"}\n`
);
process.exit(failed ? 1 : 0);

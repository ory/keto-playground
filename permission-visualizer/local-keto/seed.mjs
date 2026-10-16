#!/usr/bin/env node
// Generate a large, deep permission graph and load it into the local Keto.
//   node local-keto/seed.mjs                 seed http://localhost:4455
//   node local-keto/seed.mjs --print         print the tuples as JSON lines instead
// The generator is deterministic (seeded PRNG), so every run builds the same graph.

const KETO_URL = (process.env.KETO_URL || "http://localhost:4455").replace(/\/$/, "");
const BATCH_SIZE = 500;

// Shape of the graph. Group tree: company > divisions > departments > teams > squads.
const GROUP_FANOUT = [6, 5, 4, 3];
// Folder tree: 8 levels below the root.
const FOLDER_FANOUT = [4, 3, 3, 2, 2, 2, 2];
const USERS = 400;
const DOCUMENTS = 3000;
const CLASSES = ["claude-opus", "claude-sonnet", "claude-haiku", "claude-fable"];
const ROLES = ["auditor", "legal", "finance", "security", "hr", "support", "sales", "marketing", "exec", "contractor"];

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261016);
const pick = (list) => list[Math.floor(random() * list.length)];
const pad = (n, width = 4) => String(n).padStart(width, "0");

const tuples = [];
const seen = new Set();
const subject = (namespace, object, relation = "") => ({ subject_set: { namespace, object, relation } });
function add(namespace, object, relation, subj) {
  const key = JSON.stringify([namespace, object, relation, subj]);
  if (seen.has(key)) return;
  seen.add(key);
  tuples.push({ namespace, object, relation, ...subj });
}

const users = Array.from({ length: USERS }, (_, i) => `user-${pad(i + 1)}`);
const user = (id) => subject("User", id);
const groupMembers = (id) => subject("Group", id, "members");

// Groups: each parent group's members include its children's members (5 levels deep).
const groupLevels = [["acme"]];
for (const [depth, fanout] of GROUP_FANOUT.entries()) {
  const level = [];
  for (const parent of groupLevels[depth]) {
    for (let i = 1; i <= fanout; i++) {
      const child = `${parent}.${["div", "dept", "team", "squad"][depth]}${i}`;
      add("Group", parent, "members", groupMembers(child));
      level.push(child);
    }
  }
  groupLevels.push(level);
}
const squads = groupLevels.at(-1);
const allGroups = groupLevels.flat();
// Every user sits in 1–3 squads; a few senior users also sit higher up.
for (const u of users) {
  for (let i = 0, n = 1 + Math.floor(random() * 3); i < n; i++) add("Group", pick(squads), "members", user(u));
}
for (let i = 0; i < 40; i++) add("Group", pick(groupLevels[1].concat(groupLevels[2])), "members", user(pick(users)));
// Hub user: a member of 60 groups across every level (wide first hop).
for (let i = 0; i < 60; i++) add("Group", pick(allGroups), "members", user("user-hub"));

// Roles and model classes, held by users and whole groups.
for (const role of ROLES) {
  for (let i = 0; i < 8; i++) add("Role", role, "holders", user(pick(users)));
  add("Role", role, "holders", groupMembers(pick(groupLevels[2])));
}
for (const cls of CLASSES) {
  for (let i = 0; i < 12; i++) add("ClaudeClass", cls, "members", user(pick(users)));
  add("ClaudeClass", cls, "members", groupMembers(pick(groupLevels[3])));
}
add("ClaudeClass", "claude-opus", "members", user("user-hub"));

// Folders: an 8-level tree; ownership near the top, editors/viewers spread through it.
const folderLevels = [["root"]];
for (const [depth, fanout] of FOLDER_FANOUT.entries()) {
  const level = [];
  for (const parent of folderLevels[depth]) {
    for (let i = 1; i <= fanout; i++) {
      const child = `${parent === "root" ? "" : parent + "-"}f${depth + 1}.${i}`;
      add("Folder", child, "parents", subject("Folder", parent));
      level.push(child);
    }
  }
  folderLevels.push(level);
}
const allFolders = folderLevels.flat();
add("Folder", "root", "owners", groupMembers("acme"));
for (const [i, folder] of folderLevels[1].entries()) add("Folder", folder, "owners", groupMembers(groupLevels[1][i]));
for (const folder of allFolders) {
  if (random() < 0.25) add("Folder", folder, "editors", groupMembers(pick(allGroups)));
  if (random() < 0.15) add("Folder", folder, "viewers", subject("Role", pick(ROLES), "holders"));
  if (random() < 0.10) add("Folder", folder, "viewers", user(pick(users)));
}

// Documents: most live deep in the tree; one hub folder holds 300 (wide fan-in).
const deepFolders = folderLevels.slice(4).flat();
const hubFolder = folderLevels[3][0];
for (let i = 1; i <= DOCUMENTS; i++) {
  const scoped = i % 8 === 0;
  const cls = pick(CLASSES);
  const doc = scoped ? `report-${pad(i)}/${cls}` : `doc-${pad(i)}`;
  add("Document", doc, "parents", subject("Folder", i <= 300 ? hubFolder : pick(deepFolders)));
  add("Document", doc, "owners", user(pick(users)));
  if (random() < 0.3) add("Document", doc, "editors", groupMembers(pick(allGroups)));
  if (random() < 0.2) add("Document", doc, "viewers", user(pick(users)));
  if (scoped) add("Document", doc, "viewers", subject("ClaudeClass", cls, "members"));
}
for (let i = 0; i < 25; i++) add("Document", `doc-${pad(1 + i)}`, "viewers", user("user-hub"));

// A few legacy subject_id tuples (deprecated form) for the "Direct ID" picker group.
for (let i = 1; i <= 12; i++) add("Document", `doc-${pad(3000 - i)}`, "viewers", { subject_id: `legacy-service-${i}` });

async function seed() {
  for (let i = 0; i < tuples.length; i += BATCH_SIZE) {
    const batch = tuples.slice(i, i + BATCH_SIZE).map((relation_tuple) => ({ action: "insert", relation_tuple }));
    const res = await fetch(`${KETO_URL}/admin/relation-tuples`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`insert batch ${i / BATCH_SIZE + 1}: ${res.status} ${await res.text()}`);
  }
  const counts = {};
  for (const t of tuples) counts[t.namespace] = (counts[t.namespace] ?? 0) + 1;
  console.log(`seeded ${tuples.length} tuples into ${KETO_URL}:`, counts);
  console.log(`groups ${allGroups.length} (5 levels), folders ${allFolders.length} (8 levels), documents ${DOCUMENTS}, users ${USERS + 1}`);
}

if (process.argv.includes("--print")) {
  for (const t of tuples) console.log(JSON.stringify(t));
} else {
  seed().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

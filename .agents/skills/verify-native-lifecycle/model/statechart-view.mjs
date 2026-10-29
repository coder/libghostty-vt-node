// View for /statechart: labels each model state and step in the words of a
// package user. Used with model/chart.cfg (one worker, one terminal).
const thread = (s) => ({ idle: "not loaded", loaded: "addon loaded", exited: "exited" })[s];
const owner = (o) => (o === "none" ? "empty" : o === "main" ? "main's" : "worker's");
// per_env stores one slot for each env; process_static (old code) stores one.
const slots = (s) => (typeof s === "string" ? { "Class reference": owner(s) } : {
  "Main's class reference": owner(s.main),
  "Worker's class reference": owner(s.w1),
});
const handleState = (state, frees) => (frees > 1 ? "freed twice" : state === "freed" ? "freed" : "open");
const terminal = (t) => {
  if (t.js === "none") return "none";
  const where = t.in === "main" ? "main" : "worker";
  if (t.js === "failed") return `${where}: createTerminal threw, handle ${handleState(t.handle, t.frees)}`;
  const js = { live: "in use", disposed: "disposed", dropped: "unreachable", finalized: "collected" }[t.js];
  const call = { idle: "", ts: ", encodeMouse checking arguments", native: ", encodeMouse reading arguments" }[t.call];
  return `${where}: ${js}, handle ${handleState(t.handle, t.frees)}, ` +
    `mouse encoder ${handleState(t.enc, t.encFrees)}${call}`;
};

export const title = "libghostty-vt-node: the main thread and a worker, each with its own class reference";

export const state = (v) => ({
  "Main thread": thread(v.env.main),
  Worker: thread(v.env.w1),
  ...slots(v.slot),
  Terminal: terminal(v.term.t1),
});

const who = (from, to) => {
  for (const e of Object.keys(to.env)) if (from.env[e] !== to.env[e]) return e === "main" ? "main" : "the worker";
  return "a thread";
};
const creator = (to) => (to.term.t1.in === "main" ? "main" : "the worker");

export const step = (action, from, to) => {
  switch (action) {
    case "LoadAddon":
      return `${who(from, to)} imports the package`;
    case "CreateTerminal":
      return `${creator(to)} calls createTerminal`;
    case "CreateFails":
      return `${creator(to)} calls createTerminal, and the mouse encoder allocation fails`;
    case "EncodeTs":
      return to.term.t1.call === "ts" ? "the program calls encodeMouse" : null;
    case "EncodeEnter":
      return to.handleUse.op === "none" ? "encodeMouse enters the addon" : "encodeMouse writes mouse bytes";
    case "EncodeCall":
      return to.handleUse.op === "none" ? null : "encodeMouse writes mouse bytes";
    case "EncodeThrows":
      return "a getter in the encodeMouse arguments throws";
    case "Use":
      return to.handleUse.op === "none" ? null : "the program feeds or reads the terminal";
    case "Dispose":
      return "the program calls dispose()";
    case "Drop":
      return "the program drops the terminal";
    case "Finalize":
      return "the GC collects the terminal";
    case "WorkerExit":
      return "the worker exits";
    default:
      throw new Error(`unknown action ${action}`);
  }
};

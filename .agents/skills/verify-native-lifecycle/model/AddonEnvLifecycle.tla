-------------------------- MODULE AddonEnvLifecycle --------------------------
(***************************************************************************)
(* How @coder/libghostty-vt-node keeps native state across Node           *)
(* environments (the main thread and each worker_threads Worker), and     *)
(* across one terminal's life: create, use, dispose, garbage collection.  *)
(*                                                                         *)
(* Each action is one step that the code takes without other JS code     *)
(* running in between. Each action names the code it stands for.          *)
(* The verify skill that runs this model is                               *)
(* .agents/skills/verify-native-lifecycle/SKILL.md                        *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    Main,             \* the main thread's Node environment
    Workers,          \* worker_threads environments
    Terminals,        \* JS terminal objects the program can create
    CtorStorage,      \* where the TerminalWrap class reference lives:
                      \*  "per_env": one slot for each environment, in its
                      \*     instance data (TerminalWrap::Init calls
                      \*     env.SetInstanceData). This is the current code.
                      \*  "process_static": one slot for the whole process (a
                      \*     `static Napi::FunctionReference constructor`). This
                      \*     was the code before the F1 fix.
    DisposeClearsPtr, \* DisposeNative sets `terminal_ = nullptr` after
                      \* ghostty_terminal_free (native/terminal.cc). Code: TRUE.
    TsDisposedGuard,  \* Terminal.#assertUsable throws after dispose
                      \* (src/index.ts). Code: TRUE.
    NativeNullGuard   \* TerminalWrap::RequireTerminal throws when terminal_ is
                      \* nullptr (native/terminal.cc). Code: TRUE.

ASSUME CtorStorage \in {"process_static", "per_env"}
ASSUME {DisposeClearsPtr, TsDisposedGuard, NativeNullGuard} \subseteq BOOLEAN
ASSUME Main \notin Workers

Envs == {Main} \cup Workers
None == "none"

VARIABLES
    env,        \* env[e]: "idle" (addon not loaded yet), "loaded", or "exited"
    slot,       \* the env that created the reference held in the constructor
                \* slot, or None. process_static: one value. per_env: Envs -> value.
    term,       \* term[t]: the JS Terminal, its TerminalWrap, and its handle
    refUse,     \* the napi reference that this step touched
    handleUse   \* the libghostty call (other than free) that this step made

vars == <<env, slot, term, refUse, handleUse>>

NoRefUse    == [op |-> "none", by |-> None, owner |-> None]
NoHandleUse == [op |-> "none", t |-> None, state |-> "none"]

\* in:     the env that created the terminal
\* js:     "none" (not created), "live", "disposed" (Terminal.#disposed),
\*         "dropped" (unreachable, not yet collected), "finalized"
\* ptr:    TerminalWrap::terminal_ != nullptr
\* handle: the GhosttyTerminal: "none", "live", or "freed"
\* frees:  how many times ghostty_terminal_free ran on this handle
Unborn == [in |-> None, js |-> "none", ptr |-> FALSE, handle |-> "none", frees |-> 0]

SlotOf(e) == IF CtorStorage = "process_static" THEN slot ELSE slot[e]
SetSlot(e, owner) ==
    IF CtorStorage = "process_static" THEN owner ELSE [slot EXCEPT ![e] = owner]

\* TerminalWrap::DisposeNative (native/terminal.cc):
\*   if (terminal_ == nullptr) return;
\*   ghostty_terminal_free(terminal_);
\*   terminal_ = nullptr;
DisposeNative(r) ==
    IF r.ptr
    THEN [r EXCEPT !.handle = "freed", !.frees = r.frees + 1, !.ptr = ~DisposeClearsPtr]
    ELSE r

TypeOK ==
    /\ env \in [Envs -> {"idle", "loaded", "exited"}]
    /\ \A t \in Terminals :
         /\ term[t].in \in Envs \cup {None}
         /\ term[t].js \in {"none", "live", "disposed", "dropped", "finalized"}
         /\ term[t].ptr \in BOOLEAN
         /\ term[t].handle \in {"none", "live", "freed"}
         /\ term[t].frees \in 0..2

Init ==
    /\ env = [e \in Envs |-> "idle"]
    /\ slot = IF CtorStorage = "process_static" THEN None ELSE [e \in Envs |-> None]
    /\ term = [t \in Terminals |-> Unborn]
    /\ refUse = NoRefUse
    /\ handleUse = NoHandleUse

(***************************************************************************)
(* The first import of dist/index.js in env e calls loadNative            *)
(* (src/loader.ts), so node-gyp-build loads the addon: NODE_API_MODULE ->  *)
(* InitAll -> TerminalWrap::Init (native/addon.cc, native/terminal.cc).    *)
(* per_env: Init asserts that this env's instance-data slot is empty, and *)
(* stores a new reference with env.SetInstanceData. process_static:        *)
(* `constructor =                                                          *)
(* Napi::Persistent(func)` is a move assignment, and node-addon-api's      *)
(* Reference::operator= runs napi_delete_reference(old _env, old _ref).    *)
(* Each env loads the addon once: loadNative caches it.                    *)
(***************************************************************************)
LoadAddon(e) ==
    /\ env[e] = "idle"
    /\ env' = [env EXCEPT ![e] = "loaded"]
    /\ refUse' = IF SlotOf(e) = None THEN NoRefUse
                 ELSE [op |-> "load deletes old reference", by |-> e, owner |-> SlotOf(e)]
    /\ slot' = SetSlot(e, e)
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED term

(***************************************************************************)
(* createTerminal (src/index.ts) -> native CreateTerminal ->               *)
(* TerminalWrap::Create (native/terminal.cc): per_env reads the reference  *)
(* with env.GetInstanceData; process_static reads the static. Then         *)
(* FunctionReference::New runs in the env stored in the reference, not in  *)
(* the caller's env. The TerminalWrap constructor calls                    *)
(* ghostty_terminal_new.                                                   *)
(***************************************************************************)
CreateTerminal(e, t) ==
    /\ env[e] = "loaded"
    /\ term[t].js = "none"
    /\ refUse' = [op |-> "createTerminal uses class reference", by |-> e, owner |-> SlotOf(e)]
    /\ term' = [term EXCEPT ![t] =
                  [in |-> e, js |-> "live", ptr |-> TRUE, handle |-> "live", frees |-> 0]]
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED <<env, slot>>

(***************************************************************************)
(* feed, resize, snapshot, getVisibleText, formatPlain, formatHtml         *)
(* (src/index.ts). Terminal.#assertUsable throws after dispose. Then the   *)
(* native method calls RequireTerminal, which throws when terminal_ is     *)
(* nullptr. Otherwise the method calls libghostty with terminal_.          *)
(***************************************************************************)
Use(t) ==
    LET r == term[t]
        tsStops     == TsDisposedGuard /\ r.js = "disposed"
        nativeStops == NativeNullGuard /\ ~r.ptr
    IN /\ r.js \in {"live", "disposed"}
       /\ env[r.in] = "loaded"
       /\ handleUse' = IF tsStops \/ nativeStops THEN NoHandleUse
                       ELSE [op |-> "libghostty call", t |-> t,
                             state |-> IF r.ptr THEN r.handle ELSE "null"]
       /\ refUse' = NoRefUse
       /\ UNCHANGED <<env, slot, term>>

(***************************************************************************)
(* Terminal.dispose (src/index.ts): it returns at once when #disposed is   *)
(* set. Otherwise it calls the native dispose, TerminalWrap::Dispose ->    *)
(* DisposeNative (native/terminal.cc), and then sets #disposed.            *)
(***************************************************************************)
Dispose(t) ==
    /\ term[t].js = "live"
    /\ env[term[t].in] = "loaded"
    /\ term' = [term EXCEPT ![t] = [DisposeNative(@) EXCEPT !.js = "disposed"]]
    /\ refUse' = NoRefUse
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED <<env, slot>>

\* The program drops its last reference to the Terminal object.
Drop(t) ==
    /\ term[t].js \in {"live", "disposed"}
    /\ env[term[t].in] = "loaded"
    /\ term' = [term EXCEPT ![t].js = "dropped"]
    /\ refUse' = NoRefUse
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED <<env, slot>>

\* V8 collects the object. The ObjectWrap finalizer deletes the TerminalWrap:
\* ~TerminalWrap -> DisposeNative (native/terminal.cc).
Finalize(t) ==
    /\ term[t].js = "dropped"
    /\ env[term[t].in] = "loaded"
    /\ term' = [term EXCEPT ![t] = [DisposeNative(@) EXCEPT !.js = "finalized"]]
    /\ refUse' = NoRefUse
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED <<env, slot>>

(***************************************************************************)
(* A Worker exits. Node tears down its environment: it runs the finalizer  *)
(* of each object that is still wrapped (~TerminalWrap -> DisposeNative),  *)
(* and the references that the env created become invalid. A               *)
(* process-static constructor slot keeps the stale value.                  *)
(***************************************************************************)
WorkerExit(w) ==
    /\ env[w] = "loaded"
    /\ env' = [env EXCEPT ![w] = "exited"]
    /\ term' = [t \in Terminals |->
                  IF term[t].in = w /\ term[t].js \in {"live", "disposed", "dropped"}
                  THEN [DisposeNative(term[t]) EXCEPT !.js = "finalized"]
                  ELSE term[t]]
    /\ refUse' = NoRefUse
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED slot

Next ==
    \/ \E e \in Envs : LoadAddon(e)
    \/ \E e \in Envs, t \in Terminals : CreateTerminal(e, t)
    \/ \E t \in Terminals : Use(t)
    \/ \E t \in Terminals : Dispose(t)
    \/ \E t \in Terminals : Drop(t)
    \/ \E t \in Terminals : Finalize(t)
    \/ \E w \in Workers : WorkerExit(w)

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Rules                                                                   *)
(***************************************************************************)

\* createTerminal in a thread uses the class reference that this thread made.
CreateUsesOwnClass ==
    refUse.op = "createTerminal uses class reference" => refUse.owner = refUse.by

\* Loading the addon in a thread never deletes another thread's reference.
LoadDeletesOnlyOwnRef ==
    refUse.op = "load deletes old reference" => refUse.owner = refUse.by

\* libghostty frees each terminal handle at most once.
HandleFreedOnce == \A t \in Terminals : term[t].frees <= 1

\* No libghostty call reaches a freed or null terminal handle.
NoCallOnDeadHandle ==
    handleUse.op = "libghostty call" => handleUse.state = "live"

=============================================================================

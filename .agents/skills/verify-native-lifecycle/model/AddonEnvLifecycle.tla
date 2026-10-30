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
    NativeNullGuard,  \* TerminalWrap::RequireTerminal throws when terminal_ is
                      \* nullptr, and RequireMouseEncoder when mouse_encoder_
                      \* is nullptr (native/terminal.cc). Code: TRUE.
    EncoderClearsPtr, \* DisposeNative sets `mouse_encoder_ = nullptr` after
                      \* ghostty_mouse_encoder_free. Code: TRUE.
    JsInNativeRead,   \* JS can run while TerminalWrap::EncodeMouse reads its
                      \* arguments with Get(): a getter on Object.prototype for a
                      \* key that src/index.ts omits (`button`, `modifiers`), or a
                      \* caller that holds the raw native object. Code: TRUE.
    TakeHandlesLast   \* EncodeMouse reads every argument before it copies
                      \* terminal_ and mouse_encoder_ into locals. Code: TRUE.
                      \* FALSE is the code before the F2 fix.

ASSUME CtorStorage \in {"process_static", "per_env"}
ASSUME {DisposeClearsPtr, TsDisposedGuard, NativeNullGuard,
        EncoderClearsPtr, JsInNativeRead, TakeHandlesLast} \subseteq BOOLEAN
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
\* encPtr, enc, encFrees: the same three for mouse_encoder_ (GhosttyMouseEncoder)
\* call:   where an encodeMouse call on this terminal is: "idle"; "ts" (in
\*         Terminal.encodeMouse after #assertUsable, while the normalizers read
\*         the caller's objects, so caller getters can run); "native" (in
\*         TerminalWrap::EncodeMouse, reading arguments with Get())
\* took:   what the native locals `terminal` and `encoder` hold: "none" (not
\*         copied yet), "ptr" (copies of terminal_ and mouse_encoder_), "null"
Unborn == [in |-> None, js |-> "none", ptr |-> FALSE, handle |-> "none", frees |-> 0,
           encPtr |-> FALSE, enc |-> "none", encFrees |-> 0, call |-> "idle", took |-> "none"]
Born(e) == [in |-> e, js |-> "live", ptr |-> TRUE, handle |-> "live", frees |-> 0,
            encPtr |-> TRUE, enc |-> "live", encFrees |-> 0, call |-> "idle", took |-> "none"]

SlotOf(e) == IF CtorStorage = "process_static" THEN slot ELSE slot[e]
SetSlot(e, owner) ==
    IF CtorStorage = "process_static" THEN owner ELSE [slot EXCEPT ![e] = owner]

\* TerminalWrap::DisposeNative (native/terminal.cc):
\*   if (mouse_encoder_ != nullptr) { ghostty_mouse_encoder_free(..); mouse_encoder_ = nullptr; }
\*   if (terminal_ != nullptr) { ghostty_terminal_free(terminal_); terminal_ = nullptr; }
DisposeNative(r) ==
    LET r1 == IF r.encPtr
              THEN [r EXCEPT !.enc = "freed", !.encFrees = r.encFrees + 1,
                             !.encPtr = ~EncoderClearsPtr]
              ELSE r
    IN IF r1.ptr
       THEN [r1 EXCEPT !.handle = "freed", !.frees = r1.frees + 1, !.ptr = ~DisposeClearsPtr]
       ELSE r1

\* The state of the handles that the libghostty calls in EncodeMouse reach.
CallState(r, took) ==
    IF took = "ptr"
    THEN IF r.handle = "live" /\ r.enc = "live" THEN "live" ELSE "freed"
    ELSE "null"
Usable(r) == r.ptr /\ r.encPtr

TypeOK ==
    /\ env \in [Envs -> {"idle", "loaded", "exited"}]
    /\ \A t \in Terminals :
         /\ term[t].in \in Envs \cup {None}
         /\ term[t].js \in {"none", "failed", "live", "disposed", "dropped", "finalized"}
         /\ term[t].ptr \in BOOLEAN
         /\ term[t].handle \in {"none", "live", "freed"}
         /\ term[t].frees \in 0..2
         /\ term[t].encPtr \in BOOLEAN
         /\ term[t].enc \in {"none", "live", "freed"}
         /\ term[t].encFrees \in 0..2
         /\ term[t].call \in {"idle", "ts", "native"}
         /\ term[t].took \in {"none", "ptr", "null"}

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
(* ghostty_terminal_new and ghostty_terminal_set, then                     *)
(* ghostty_mouse_encoder_new.                                              *)
(***************************************************************************)
CreateTerminal(e, t) ==
    /\ env[e] = "loaded"
    /\ term[t].js = "none"
    /\ refUse' = [op |-> "createTerminal uses class reference", by |-> e, owner |-> SlotOf(e)]
    /\ term' = [term EXCEPT ![t] = Born(e)]
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED <<env, slot>>

\* ghostty_terminal_set or ghostty_mouse_encoder_new fails: the constructor
\* frees the terminal once, leaves terminal_ = nullptr, and throws.
\* ~TerminalWrap does not run, because the C++ constructor did not finish.
\* No JS object exists.
CreateFails(e, t) ==
    /\ env[e] = "loaded"
    /\ term[t].js = "none"
    /\ refUse' = [op |-> "createTerminal uses class reference", by |-> e, owner |-> SlotOf(e)]
    /\ term' = [term EXCEPT ![t] = [Unborn EXCEPT !.in = e, !.js = "failed",
                                                   !.handle = "freed", !.frees = 1]]
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

(***************************************************************************)
(* encodeMouse is three steps, because caller JS can run between them.    *)
(* EncodeTs: Terminal.encodeMouse runs #assertUsable, then the normalizers *)
(*   read the caller's event and options. A getter there can run any JS,   *)
(*   for example dispose() on this terminal.                               *)
(* EncodeEnter: this.#native.encodeMouse enters TerminalWrap::EncodeMouse, *)
(*   which reads its arguments with Get(). Before the F2 fix              *)
(*   (TakeHandlesLast = FALSE), it first copied terminal_ and             *)
(*   mouse_encoder_ into locals (RequireTerminal, RequireMouseEncoder).    *)
(* EncodeCall: the reads end. With TakeHandlesLast, EncodeMouse checks and *)
(*   copies the pointers here. Then it calls ghostty_terminal_get          *)
(*   (mode) and the ghostty_mouse_encoder_* functions, and no JS runs      *)
(*   until return.                                                         *)
(* Without JsInNativeRead, EncodeEnter and EncodeCall are one step.        *)
(***************************************************************************)
EncodeTs(t) ==
    LET r == term[t] IN
    /\ r.js \in {"live", "disposed"}
    /\ env[r.in] = "loaded"
    /\ r.call = "idle"
    /\ term' = IF TsDisposedGuard /\ r.js = "disposed"
               THEN term                                 \* throws "disposed"
               ELSE [term EXCEPT ![t].call = "ts"]
    /\ refUse' = NoRefUse
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED <<env, slot>>

\* What the native locals hold after RequireTerminal and RequireMouseEncoder,
\* or "stop" when a null guard throws.
Take(r) ==
    IF Usable(r) THEN "ptr"
    ELSE IF NativeNullGuard THEN "stop" ELSE "null"

CallNow(t, took) ==
    /\ handleUse' = IF took = "stop" THEN NoHandleUse
                    ELSE [op |-> "libghostty call", t |-> t, state |-> CallState(term[t], took)]
    /\ term' = [term EXCEPT ![t].call = "idle", ![t].took = "none"]

EncodeEnter(t) ==
    LET r == term[t] IN
    /\ r.call = "ts"
    /\ env[r.in] = "loaded"
    /\ IF ~JsInNativeRead
       THEN CallNow(t, Take(r))
       ELSE /\ handleUse' = NoHandleUse
            /\ term' = IF TakeHandlesLast
                       THEN [term EXCEPT ![t].call = "native"]
                       ELSE IF Take(r) = "stop"
                            THEN [term EXCEPT ![t].call = "idle"]
                            ELSE [term EXCEPT ![t].call = "native", ![t].took = Take(r)]
    /\ refUse' = NoRefUse
    /\ UNCHANGED <<env, slot>>

EncodeCall(t) ==
    LET r == term[t] IN
    /\ JsInNativeRead
    /\ r.call = "native"
    /\ env[r.in] = "loaded"
    /\ CallNow(t, IF TakeHandlesLast THEN Take(r) ELSE r.took)
    /\ refUse' = NoRefUse
    /\ UNCHANGED <<env, slot>>

\* A getter throws in either read phase: the call ends without a libghostty call.
EncodeThrows(t) ==
    /\ term[t].call \in {"ts", "native"}
    /\ term' = [term EXCEPT ![t].call = "idle", ![t].took = "none"]
    /\ refUse' = NoRefUse
    /\ handleUse' = NoHandleUse
    /\ UNCHANGED <<env, slot>>

\* The program drops its last reference to the Terminal object. An object
\* whose method is still running is reachable, so it cannot be dropped then.
Drop(t) ==
    /\ term[t].call = "idle"
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
    \* A terminating Worker first unwinds its JS stack (EncodeThrows).
    /\ \A t \in Terminals : term[t].in = w => term[t].call = "idle"
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
    \/ \E e \in Envs, t \in Terminals : CreateFails(e, t)
    \/ \E t \in Terminals : EncodeTs(t)
    \/ \E t \in Terminals : EncodeEnter(t)
    \/ \E t \in Terminals : EncodeCall(t)
    \/ \E t \in Terminals : EncodeThrows(t)
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

\* libghostty frees each mouse encoder at most once.
EncoderFreedOnce == \A t \in Terminals : term[t].encFrees <= 1

\* No libghostty call reaches a freed or null terminal or mouse encoder handle.
NoCallOnDeadHandle ==
    handleUse.op = "libghostty call" => handleUse.state = "live"

=============================================================================

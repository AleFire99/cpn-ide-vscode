// SML for the state space search (spike #104), evaluated through sim/script on top of the ASAP interface (CPNToolsModel).
// Raw strings: the SML has backslashes but no backticks or dollar-brace sequences.

/** Instantiates the ASAP interface for the current net; one sim/script call per entry, after init and sim/init. */
export const ASAP_SETUP: string[] = [
  String.raw`structure CPN'NetCapture = CPN'NetCapture(structure CPN'InstTable = CPN'InstTable)`,
  String.raw`CPN'NetCapture.initNet ()`,
  String.raw`CPN'NetCapture.checkNames()`,
  String.raw`structure CPN'State = CPN'State(structure CPN'NetCapture = CPN'NetCapture)`,
  String.raw`CPN'Env.use_string(CPN'State.genMark(CPN'NetCapture.getNet()))`,
  String.raw`CPN'Env.use_string(CPN'State.genState(CPN'NetCapture.getNet()))`,
  String.raw`structure CPN'Event = CPN'Event(structure CPN'NetCapture = CPN'NetCapture)`,
  String.raw`CPN'Env.use_string(CPN'Event.genBind(CPN'NetCapture.getNet()))`,
  String.raw`CPN'Env.use_string(CPN'Event.genEvent(CPN'NetCapture.getNet()))`,
  String.raw`structure CPNToolsModel = CPNToolsModel(structure CPNToolsState = CPNToolsState structure CPNToolsEvent = CPNToolsEvent)`,
];

/** Generates CPN'SSNames.name (Bind.event -> transition name) from the generated Bind datatype. */
export const SS_NAMES_SML = String.raw`local
  val bs = String.concat (CPN'Event.genBind (CPN'NetCapture.getNet ()));
  val lines = String.tokens (fn c => c = #"\n") bs;
  fun nm l = case String.tokens (fn c => c = #" ") l of
      ("|" :: n :: "of" :: _) => SOME n
    | ("datatype" :: "event" :: "=" :: "CPN'FAKE" :: _) => NONE
    | _ => NONE;
  val names = List.mapPartial nm lines;
  val code = "structure CPN'SSNames = struct val all = [" ^ String.concatWith "," (List.map (fn n => "\"" ^ n ^ "\"") names) ^ "]\nfun name e = case e of " ^
     String.concatWith " | " (List.map (fn n => "Bind." ^ n ^ " _ => \"" ^ n ^ "\"") names) ^ " | _ => \"?\" end";
in
  val _ = CPN'Env.use_string [code]
end;`;

/** The sliced breadth-first search: ssStart builds it, `(!ssSlice) ms` runs one slice, `(!ssFin) ()` writes a partial report. */
export const SS_EXPLORER_SML = String.raw`val ssNb = 262144;
fun ssHash (s : string) = (CharVector.foldl (fn (c, a) => (a * 33 + Char.ord c) mod 16777213) 5381 s) mod ssNb;
val ssSlice : (int -> bool) ref = ref (fn _ => true);
val ssFin : (unit -> unit) ref = ref (fn () => ());
fun ssStart (pids : string list, maxNodes : int, outFile : string) =
let
  val t0 = Time.now ();
  val tbl : (string * int) list Array.array = Array.array (ssNb, []);
  val parent = Array.array (maxNodes + 2, ~1);
  val pev = Array.array (maxNodes + 2, "");
  val nodes = ref 0;
  val arcs = ref 0;
  val np = List.length pids;
  val lo = Array.array (np, 1000000000);
  val hi = Array.array (np, 0);
  val fired : string list ref = ref [];
  val dead : (int * string) list ref = ref [];
  val complete = ref true;
  val info = List.map (fn id => valOf (HashTable.find CPN'Place.instances id)) pids;
  val front : (int * CPNToolsState.state * CPNToolsModel.event list) list ref = ref [];
  val back : (int * CPNToolsState.state * CPNToolsModel.event list) list ref = ref [];
  fun visit s =
    (CPNToolsState.setState s;
     ignore (List.foldl (fn (i, k) =>
        let val n = #size i 1 in
          (if n < Array.sub (lo, k) then Array.update (lo, k, n) else ());
          (if n > Array.sub (hi, k) then Array.update (hi, k, n) else ());
          k + 1 end) 0 info));
  fun lookup (s, p, e) =
    let val key = CPNToolsState.toString s;
        val h = ssHash key;
        val b = Array.sub (tbl, h)
    in case List.find (fn (k, _) => k = key) b of
         SOME (_, id) => (id, false)
       | NONE => if !nodes >= maxNodes then (complete := false; (~1, false))
                 else let val id = !nodes + 1 in
                        nodes := id; Array.update (tbl, h, (key, id) :: b);
                        Array.update (parent, id, p); Array.update (pev, id, e); (id, true) end
    end;
  fun trace id = if id <= 1 orelse Array.sub (parent, id) < 0 then [] else List.@ (trace (Array.sub (parent, id)), [Array.sub (pev, id)]);
  fun process (id, s, evs) =
    (visit s;
     (case evs of
        [] => dead := (id, String.concatWith " | " (List.map (fn i => String.map (fn c => if c = #"\n" then #" " else c) (#print i 1)) info)) :: !dead
      | _ => ());
     List.app (fn e =>
       let val nm = CPN'SSNames.name e;
           val succ = CPNToolsModel.nextStates (s, e) in
         (if List.exists (fn x => x = nm) (!fired) then () else fired := nm :: !fired);
         List.app (fn (s2, ev2) =>
           (arcs := !arcs + 1;
            case lookup (s2, id, nm) of
              (id2, true) => back := (id2, s2, ev2) :: !back
            | _ => ())) succ
       end) evs);
  fun finish () =
    let val f = TextIO.openOut outFile;
        fun w s = TextIO.output (f, s ^ "\n");
    in w ("nodes " ^ Int.toString (!nodes)); w ("arcs " ^ Int.toString (!arcs));
       w ("complete " ^ (if !complete andalso List.null (!front) andalso List.null (!back) then "1" else "0"));
       w ("ms " ^ LargeInt.toString (Time.toMilliseconds (Time.- (Time.now (), t0))));
       w ("fired " ^ String.concatWith "," (!fired));
       w ("alltrans " ^ String.concatWith "," CPN'SSNames.all);
       List.tabulate (np, fn i => w ("bound " ^ List.nth (pids, i) ^ " " ^ Int.toString (Array.sub (lo, i)) ^ " " ^ Int.toString (Array.sub (hi, i))));
       List.app (fn (id, m) => w ("dead " ^ Int.toString id ^ " " ^ String.concatWith "," (trace id) ^ " # " ^ m)) (List.rev (!dead));
       TextIO.closeOut f
    end;
  (* a one-line report so the caller can show progress between slices *)
  fun progress () =
    let val f = TextIO.openOut outFile in
      TextIO.output (f, "nodes " ^ Int.toString (!nodes) ^ "\n"); TextIO.closeOut f
    end;
  (* runs for at most ms milliseconds; true when finished *)
  fun slice ms =
    let val t1 = Time.now ();
        fun expired () = Time.toMilliseconds (Time.- (Time.now (), t1)) > LargeInt.fromInt ms;
        fun go () =
          (case !front of
             [] => (case !back of [] => (finish (); true) | b => (front := List.rev b; back := []; go ()))
           | x :: rest => if expired () then (progress (); false) else (front := rest; process x; go ()))
    in go () end;
  val _ = List.app (fn (s, evs) => case lookup (s, ~1, "") of (id, true) => back := (id, s, evs) :: !back | _ => ()) (CPNToolsModel.getInitialStates ());
in (ssSlice := slice; ssFin := finish) end;`;

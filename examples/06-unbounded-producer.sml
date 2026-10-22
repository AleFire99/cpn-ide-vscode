(* A producer with no inputs adds a token to Buffer on every step and nothing ever removes one:
   Buffer is unbounded, so a state space search never finishes. *)

(* Jobs 1..3 go through the Worker subpage, which tags each with whether it is even.
   Count is a fusion place shared by both pages and counts the jobs done. *)

(*! Types *)
colset JOB = int with 1..10;
colset RESULT = product JOB * BOOL;

(*! Variables *)
var j: JOB;
var c: INT;

(*! Functions *)
fun isEven (n: JOB) = n mod 2 = 0;

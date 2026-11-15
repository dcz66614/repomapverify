#!/usr/bin/env python3
"""FIX T013 R3 pre/post reproduction for R3-P1-01.

Builds probe dirs under $TMPDIR/r3-probes (never /tmp) from the S0
control fixtures and runs the REAL production CLI (node dist/cli.js
audit, true exit code captured WITHOUT a pipe) and the Oracle
(python3 oracle.py --fixture-dir) on the same repo+map.

Cases:
  py-stale-missing  -- coordinator probe: py-c01 repo + extra.py
                       (`import billing.api`) at root, map bound to the
                       clean snapshot (S0 claimed map verbatim).
  py-stale-halluc   -- reviewer probe: py-c01 clean repo, map = S0 map
                       + hallucinated edge billing/api.py ->
                       billing/nonexistent.py (+ module), snapshot
                       all-zeros.
  ts-stale-missing  -- reviewer probe: ts-ctrl-01 + extra.ts at root
                       importing ./src/util, map bound to clean snapshot.
Usage: TMPDIR=... python3 repro-stale.py <outdir>
Prints one line per case: AGREE / DIVERGE. Writes per-case
summary.json + production report + Oracle JSON under <outdir>/<case>/.
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.expanduser("~/workspace/p024-repomapverify")
SRC = os.path.join(ROOT, "02_source")
S0 = os.path.join(SRC, "tests", "fixtures", "s0")
TMP = os.environ.get("TMPDIR", os.path.join(ROOT, ".tmp"))


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def build_probes(base):
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base)

    # py-stale-missing (coordinator probe)
    d = os.path.join(base, "py-stale-missing")
    shutil.copytree(os.path.join(S0, "python", "py-c01-basic-imports", "repo"),
                    os.path.join(d, "repo"))
    shutil.copy(os.path.join(S0, "python", "py-c01-basic-imports",
                             "claimed-map.json"),
                os.path.join(d, "claimed-map.json"))
    with open(os.path.join(d, "repo", "extra.py"), "w") as fh:
        fh.write("import billing.api\n")

    # py-stale-halluc (reviewer probe, reconstructed)
    d = os.path.join(base, "py-stale-halluc")
    shutil.copytree(os.path.join(S0, "python", "py-c01-basic-imports", "repo"),
                    os.path.join(d, "repo"))
    m = json.load(open(os.path.join(
        S0, "python", "py-c01-basic-imports", "claimed-map.json")))
    m["repoSnapshotSha256"] = "0" * 64
    m["modules"].append({"id": "mX", "kind": "module",
                         "path": "billing/nonexistent.py"})
    m["edges"].append({"from": "billing/api.py",
                       "to": "billing/nonexistent.py"})
    json.dump(m, open(os.path.join(d, "claimed-map.json"), "w"), indent=2)

    # ts-stale-missing (reviewer probe)
    d = os.path.join(base, "ts-stale-missing")
    shutil.copytree(os.path.join(S0, "typescript", "ts-ctrl-01", "repo"),
                    os.path.join(d, "repo"))
    shutil.copy(os.path.join(S0, "typescript", "ts-ctrl-01",
                             "claimed-map.json"),
                os.path.join(d, "claimed-map.json"))
    with open(os.path.join(d, "repo", "extra.ts"), "w") as fh:
        fh.write("import { util } from './src/util';\n"
                 "export const x = util;\n")


def prod(case_dir, outdir):
    repo = os.path.join(case_dir, "repo")
    cmap = os.path.join(case_dir, "claimed-map.json")
    out = os.path.join(outdir, "prod-out")
    r = run(["node", "dist/cli.js", "audit", "--repo", repo, "--map", cmap,
             "--out", out], cwd=SRC)
    rep = os.path.join(out, "repomapverify-report.json")
    status, findings, snap = "?", [], "?"
    if os.path.exists(rep):
        d = json.load(open(rep))
        status = d.get("status")
        findings = sorted((f.get("id"), f.get("from"), f.get("to"))
                          for f in d.get("findings", []))
        snap = d.get("snapshotStatus")
    return {"exit": r.returncode, "status": status, "findings": findings,
            "snapshotStatus": snap,
            "stdout_tail": (r.stdout + r.stderr).strip().splitlines()[-3:]}


def oracle(case_dir, outdir):
    out = os.path.join(outdir, "oracle.json")
    r = run(["python3", "oracle/python/oracle.py", "--fixture-dir", case_dir,
             "--out", out], cwd=SRC)
    if r.returncode != 0 or not os.path.exists(out):
        return {"error": (r.stdout + r.stderr).strip()[-500:]}
    d = json.load(open(out))
    return {"status": d["audit"]["status"],
            "snapshotStatus": d["audit"]["snapshotStatus"],
            "findings": sorted((f.get("id"), f.get("from"), f.get("to"))
                               for f in d["audit"]["findings"]),
            "unknownImportsPresent": d["audit"]["unknownImportsPresent"]}


def main(outdir):
    outdir = os.path.abspath(outdir)
    base = os.path.join(TMP, "r3-probes")
    build_probes(base)
    os.makedirs(outdir, exist_ok=True)
    n_agree = n_div = 0
    for name in ["py-stale-missing", "py-stale-halluc", "ts-stale-missing"]:
        case = os.path.join(base, name)
        od = os.path.join(outdir, name)
        os.makedirs(od, exist_ok=True)
        p = prod(case, od)
        o = oracle(case, od)
        json.dump({"production": {k: v for k, v in p.items()
                                  if k != "stdout_tail"},
                   "oracle": o},
                  open(os.path.join(od, "summary.json"), "w"), indent=1,
                  default=str)
        problems = []
        if o.get("error"):
            problems.append("oracle-error: " + o["error"])
        else:
            if p["status"] != o["status"]:
                problems.append(f"verdict prod={p['status']} oracle={o['status']}")
            if p["findings"] != o["findings"]:
                problems.append(f"findings prod={p['findings']} oracle={o['findings']}")
            if p["snapshotStatus"] != o["snapshotStatus"]:
                problems.append(f"snapshotStatus prod={p['snapshotStatus']} oracle={o['snapshotStatus']}")
            if p["exit"] not in (0, 1, 2):
                problems.append(f"prod exit={p['exit']}")
        tag = "DIVERGE" if problems else "AGREE"
        n_div += bool(problems)
        n_agree += not problems
        print(f"{tag} {name}: prod exit={p['exit']} {p['status']} "
              f"({p['snapshotStatus']}) | oracle {o.get('status', '?')} "
              f"({o.get('snapshotStatus')}) findings prod={p['findings']} "
              f"oracle={o.get('findings')}"
              + (" :: " + "; ".join(problems) if problems else ""))
    print(f"TOTAL agree={n_agree} diverge={n_div}")


if __name__ == "__main__":
    main(sys.argv[1])

#!/usr/bin/env python3
"""FIX T013 R4: reproduce R4-P1-01 (ghost entrypoint) pre/post-fix.

Builds probe dirs under $TMPDIR/r4fix-probes from the S0 py-c01-basic-imports
repo and runs the REAL production CLI (node dist/cli.js audit +
ground-truth) and the Oracle (python3 oracle.py --fixture-dir) on the same
repo+map, with TRUE exit codes (subprocess returncode, no pipes).

Cases:
  py-ghost-entry   toml declares ["main.py", "ghost.py"], map claims both
                   (reviewer's probe; claimed map copied verbatim from
                   03_evidence/T013_R4/probes/py-r4-ghost-entry/).
  py-ghost-ctrl    toml declares ["main.py"] only, map claims ghost.py too.
  py-ghost-sanity  toml declares ["main.py"], map claims main.py only
                   (py-c01-basic-imports as shipped).
  go-ghost-entry   go-ctrl-01 repo, toml declares
                   ["cmd/server/main.go", "cmd/ghost/main.go"], map claims
                   both literal spellings.
Usage: TMPDIR=... python3 repro-ghost.py [--outdir DIR]
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.expanduser("~/workspace/p024-repomapverify")
SRC = os.path.join(ROOT, "02_source")
S0 = os.path.join(SRC, "tests", "fixtures", "s0")
TMP = os.environ.get("TMPDIR", os.path.join(ROOT, ".tmp"))
PROBES = os.path.join(TMP, "r4fix-probes")
R4EV = os.path.join(ROOT, "03_evidence", "T013_R4", "probes")


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def copy_repo(src, dst):
    for item in os.listdir(src):
        s, t = os.path.join(src, item), os.path.join(dst, item)
        if os.path.islink(s) or os.path.isfile(s):
            shutil.copy2(s, t, follow_symlinks=False)
        else:
            shutil.copytree(s, t, symlinks=True)


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
    gt = run(["node", "dist/cli.js", "ground-truth", "--repo", repo], cwd=SRC)
    gtj = json.loads(gt.stdout) if gt.returncode == 0 else {}
    return {"exit": r.returncode, "status": status, "findings": findings,
            "snapshotStatus": snap,
            "gt_entrypoints": gtj.get("entrypoints"),
            "gt_snapshot": gtj.get("repoSnapshotSha256"),
            "tail": (r.stdout + r.stderr).strip().splitlines()[-3:]}


def oracle(case_dir, outdir):
    out = os.path.join(outdir, "oracle.json")
    r = run(["python3", "oracle/python/oracle.py", "--fixture-dir", case_dir,
             "--out", out], cwd=SRC)
    if r.returncode != 0 or not os.path.exists(out):
        return {"error": (r.stdout + r.stderr).strip()[-400:]}
    d = json.load(open(out))
    return {"status": d["audit"]["status"],
            "snapshotStatus": d["audit"]["snapshotStatus"],
            "findings": sorted((f.get("id"), f.get("from"), f.get("to"))
                               for f in d["audit"]["findings"]),
            "unresolvedEntrypoints": d["audit"].get("unresolvedEntrypoints"),
            "gt_entrypoints": d["groundTruth"]["entrypoints"],
            "gt_snapshot": d["groundTruth"]["repoSnapshotSha256"]}


def build_py_ghost(name, toml_paths, map_src):
    d = os.path.join(PROBES, name)
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(os.path.join(d, "repo"))
    copy_repo(os.path.join(S0, "python", "py-c01-basic-imports", "repo"),
              os.path.join(d, "repo"))
    with open(os.path.join(d, "repo", ".repomapverify.toml"), "w") as fh:
        fh.write("[entrypoints]\npaths = [%s]\n" % ", ".join(
            '"%s"' % p for p in toml_paths))
    shutil.copy2(map_src, os.path.join(d, "claimed-map.json"))
    return d


def build_go_ghost(name):
    d = os.path.join(PROBES, name)
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(os.path.join(d, "repo"))
    copy_repo(os.path.join(S0, "go", "go-ctrl-01", "repo"),
              os.path.join(d, "repo"))
    with open(os.path.join(d, "repo", ".repomapverify.toml"), "w") as fh:
        fh.write('[entrypoints]\npaths = ["cmd/server/main.go", '
                 '"cmd/ghost/main.go"]\n')
    # Map from the production ground truth of the ghost repo, then claim
    # the ghost entrypoint in its literal toml spelling too.
    gt = run(["node", "dist/cli.js", "ground-truth", "--repo",
              os.path.join(d, "repo")], cwd=SRC)
    assert gt.returncode == 0, gt.stderr[-400:]
    g = json.loads(gt.stdout)
    mods = sorted(g["modules"], key=lambda m: m["relativePath"])
    m = {"schema": "repomapverify.claimed-map/v1",
         "mapId": "r4fix-go-ghost", "repo": name, "agent": "r4fix",
         "completeness": "FULL_GRAPH",
         "repoSnapshotSha256": g["repoSnapshotSha256"],
         "modules": [{"id": "m%d" % i, "path": x["relativePath"],
                      "kind": "module"} for i, x in enumerate(mods)],
         "entrypoints": ["cmd/server/main.go", "cmd/ghost/main.go"],
         "edges": [{"from": e["from"], "to": e["to"]} for e in g["edges"]]}
    with open(os.path.join(d, "claimed-map.json"), "w") as fh:
        json.dump(m, fh, indent=2)
    return d


def main():
    outdir = sys.argv[sys.argv.index("--outdir") + 1] \
        if "--outdir" in sys.argv else os.path.join(
            ROOT, "03_evidence", "FIX_T013_R4", "agreement-pre")
    cases = {}
    cases["py-ghost-entry"] = build_py_ghost(
        "py-ghost-entry", ["main.py", "ghost.py"],
        os.path.join(R4EV, "py-r4-ghost-entry", "claimed-map.json"))
    cases["py-ghost-ctrl"] = build_py_ghost(
        "py-ghost-ctrl", ["main.py"],
        os.path.join(R4EV, "py-r4-ghost-ctrl", "claimed-map.json"))
    cases["py-ghost-sanity"] = os.path.join(
        S0, "python", "py-c01-basic-imports")
    cases["go-ghost-entry"] = build_go_ghost("go-ghost-entry")
    results = {}
    for name, cdir in cases.items():
        od = os.path.join(outdir, name)
        os.makedirs(od, exist_ok=True)
        p, o = prod(cdir, od), oracle(cdir, od)
        agree = (p.get("status") == o.get("status") and
                 p.get("findings") == o.get("findings") and
                 p.get("gt_entrypoints") == o.get("gt_entrypoints"))
        results[name] = {"production": p, "oracle": o, "agree": agree}
        print(f"{name}: prod exit={p.get('exit')} {p.get('status')}/"
              f"{p.get('snapshotStatus')} findings={p.get('findings')} "
              f"gt_entrypoints={p.get('gt_entrypoints')} | oracle "
              f"{o.get('status')}/{o.get('snapshotStatus')} "
              f"findings={o.get('findings')} "
              f"unresolved={o.get('unresolvedEntrypoints')} "
              f"gt_entrypoints={o.get('gt_entrypoints')} -> "
              f"{'AGREE' if agree else 'DIVERGE'}")
    with open(os.path.join(outdir, "summary.json"), "w") as fh:
        json.dump(results, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

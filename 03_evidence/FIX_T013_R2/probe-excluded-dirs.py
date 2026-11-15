#!/usr/bin/env python3
"""Excluded-dir alignment probes (pre/post-fix). Builds probe fixture dirs
under $TMPDIR/probes/, runs production GT + audit (node dist/cli.js) and the
Oracle (--fixture-dir), and prints module sets, snapshots, verdicts."""
import json, os, shutil, subprocess, sys

ROOT = os.path.expanduser("~/workspace/p024-repomapverify")
SRC = os.path.join(ROOT, "02_source")
TMP = os.environ.get("TMPDIR", os.path.join(ROOT, ".tmp"))
BASE = os.path.join(TMP, "probes")
S0 = os.path.join(SRC, "tests", "fixtures", "s0")

def sh(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r

def prod_gt(repo):
    r = sh(["node", "dist/cli.js", "ground-truth", "--repo", repo], cwd=SRC)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout)

def prod_audit(repo, map_path, outdir):
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir, exist_ok=True)
    r = sh(["node", "dist/cli.js", "audit", "--repo", repo, "--map", map_path,
            "--out", outdir], cwd=SRC)
    rep = None
    for f in os.listdir(outdir):
        if f.endswith(".json"):
            with open(os.path.join(outdir, f)) as fh:
                rep = json.load(fh)
    status = None
    if rep:
        status = rep.get("status") or rep.get("report", {}).get("status")
    return r.returncode, status, rep

def oracle_run(fixdir, outpath):
    r = sh(["python3", os.path.join(SRC, "oracle", "python", "oracle.py"),
            "--fixture-dir", fixdir, "--out", outpath], cwd=SRC)
    assert r.returncode == 0, r.stdout + r.stderr
    with open(outpath) as fh:
        return json.load(fh)

def mods_of_prod(gt):
    return sorted(m["relativePath"] for m in gt["modules"])

def mods_of_oracle(o):
    gt = o["groundTruth"]
    return sorted(m["relativePath"] for m in gt["modules"])

def build_map_from_prod(gt, s0_map):
    id_by_path = {m["relativePath"]: m["moduleId"] for m in gt["modules"]}
    path_by_id = {v: k for k, v in id_by_path.items()}
    edges = [{"from": path_by_id[e["fromModuleId"]], "to": path_by_id[e["toModuleId"]]}
             for e in gt["edges"]]
    m = dict(s0_map)
    m["modules"] = [{"id": f"m{i+1}", "kind": "module", "path": p}
                    for i, p in enumerate(sorted(id_by_path))]
    m["edges"] = edges
    m["repoSnapshotSha256"] = gt["repoSnapshotSha256"]
    return m

def probe(name, s0_fixture, extra_files, lang_prefix):
    """extra_files: {relpath: content}; s0_fixture e.g. python/py-c01-basic-imports"""
    s0dir = os.path.join(S0, s0_fixture)
    fixdir = os.path.join(BASE, name)
    repo = os.path.join(fixdir, "repo")
    shutil.rmtree(fixdir, ignore_errors=True)
    shutil.copytree(os.path.join(s0dir, "repo"), repo, symlinks=True)
    for rel, content in extra_files.items():
        p = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        mode = "wb" if isinstance(content, bytes) else "w"
        with open(p, mode) as fh:
            fh.write(content)
    with open(os.path.join(s0dir, "claimed-map.json")) as fh:
        s0_map = json.load(fh)
    gt = prod_gt(repo)
    cmap = build_map_from_prod(gt, s0_map)
    with open(os.path.join(fixdir, "claimed-map.json"), "w") as fh:
        json.dump(cmap, fh, indent=2, sort_keys=True)
    code, status, _ = prod_audit(repo, os.path.join(fixdir, "claimed-map.json"),
                                 os.path.join(fixdir, "prod-out"))
    o = oracle_run(fixdir, os.path.join(fixdir, "oracle.json"))
    pm, om = mods_of_prod(gt), mods_of_oracle(o)
    agree = (pm == om and gt["repoSnapshotSha256"] == o["groundTruth"]["repoSnapshotSha256"]
             and status == o["audit"]["status"])
    print(f"--- {name}")
    print(f"  prod : {len(pm)} modules {pm} snap={gt['repoSnapshotSha256'][:12]} audit exit={code} status={status}")
    print(f"  orac : {len(om)} modules {om} snap={o['groundTruth']['repoSnapshotSha256'][:12]} audit status={o['audit']['status']} findings={[f['id'] for f in o['audit'].get('findings',[])]}")
    print(f"  AGREE: {agree}")
    return agree

if __name__ == "__main__":
    os.makedirs(BASE, exist_ok=True)
    results = {}
    results["A py-venv"] = probe("py-venv", "python/py-c01-basic-imports",
        {"venv/lib/pkg.py": "x = 1\n"}, "py")
    results["A2 py-dotvenv"] = probe("py-dotvenv", "python/py-c01-basic-imports",
        {".venv/lib/pkg.py": "x = 1\n"}, "py")
    results["E py-pycache-py"] = probe("py-pycache", "python/py-c01-basic-imports",
        {"billing/__pycache__/stray.py": "x = 1\n"}, "py")
    results["B ts-venv"] = probe("ts-venv", "typescript/ts-ctrl-01",
        {"venv/lib/foo.ts": "export const x = 1;\n"}, "ts")
    results["F ts-nodemod"] = probe("ts-nodemod", "typescript/ts-ctrl-01",
        {"node_modules/pkg/index.ts": "export const y = 2;\n"}, "ts")
    results["C go-nodemod"] = probe("go-nodemod", "go/go-ctrl-01",
        {"node_modules/pkg/x.go": "package pkg\n\nfunc Hi() {}\n"}, "go")
    results["G go-venv"] = probe("go-venv", "go/go-ctrl-01",
        {"venv/lib/x.go": "package lib\n\nfunc Hi() {}\n"}, "go")
    results["H go-pycache"] = probe("go-pycache", "go/go-ctrl-01",
        {"__pycache__/x.go": "package cache\n\nfunc Hi() {}\n"}, "go")
    results["D go-testdata"] = probe("go-testdata", "go/go-ctrl-01",
        {"testdata/x.go": "package testdata\n\nfunc Hi() {}\n",
         "cmd/server/main_test.go": "package main\n\nimport \"testing\"\n\nfunc TestX(t *testing.T) {}\n"}, "go")
    print("\nSUMMARY:")
    for k, v in results.items():
        print(f"  {k}: {'AGREE' if v else 'DIVERGE'}")

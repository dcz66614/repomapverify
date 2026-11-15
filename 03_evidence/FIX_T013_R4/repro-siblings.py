#!/usr/bin/env python3
"""FIX T013 R4: sibling-passthrough probes (Rule 8: droppedEdges /
conflicts). See 00_control/HANDOFF_FIX_T013_R4.md section 4.

  (1) self-edge (real repo, both CLIs): py-c01 + `import main` in main.py
      (a self-import). Production buildGraph drops self-edges
      (SELF_EDGE, benign); the Oracle skips them in add_edge. Both
      sides must agree (map built from the production GT).
  (2) droppedEdges UNKNOWN_ENDPOINT (unit-level only): a synthetic
      BuiltGraph with an edge to an unknown moduleId, audited
      in-process, vs the Oracle audit on the equivalent GT (no such
      edge, no unknown import). Demonstrates the mechanism and that the
      Oracle GT schema carries no droppedEdges counterpart.
  (3) unreadable-file route (CLI, non-root via unshare -Ur): TS repo
      with chmod-000 src/secret.ts imported by src/util.ts. As root
      this cannot be staged (chmod 000 does not block root); the
      unshare user namespace drops DAC-override over host-root-owned
      files, so the 000 file blocks inside it. Run separately:
        unshare -Urn python3 repro-siblings.py --unreadable
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.expanduser("~/workspace/p024-repomapverify")
SRC = os.path.join(ROOT, "02_source")
S0 = os.path.join(SRC, "tests", "fixtures", "s0")
TMP = os.environ.get("TMPDIR", os.path.join(ROOT, ".tmp"))
PROBES = os.path.join(TMP, "r4fix-siblings")
EV = os.path.join(ROOT, "03_evidence", "FIX_T013_R4", "siblings")


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def copy_repo(src, dst):
    for item in os.listdir(src):
        s, t = os.path.join(src, item), os.path.join(dst, item)
        if os.path.islink(s) or os.path.isfile(s):
            shutil.copy2(s, t, follow_symlinks=False)
        else:
            shutil.copytree(s, t, symlinks=True)


def build_map_from_gt(repo_dir, extra_entries=None):
    r = run(["node", "dist/cli.js", "ground-truth", "--repo", repo_dir],
            cwd=SRC)
    assert r.returncode == 0, r.stderr[-400:]
    gt = json.loads(r.stdout)
    mods = sorted(gt["modules"], key=lambda m: m["relativePath"])
    m = {"schema": "repomapverify.claimed-map/v1",
         "mapId": "r4fix-sibling", "repo": "sibling", "agent": "r4fix",
         "completeness": "FULL_GRAPH",
         "repoSnapshotSha256": gt["repoSnapshotSha256"],
         "modules": [{"id": "m%d" % i, "path": x["relativePath"],
                      "kind": "module"} for i, x in enumerate(mods)],
         "entrypoints": list(extra_entries) if extra_entries is not None
         else gt["entrypoints"],
         "edges": [{"from": e["from"], "to": e["to"]} for e in gt["edges"]]}
    return m, gt


def audit_both(case_dir, outdir):
    repo = os.path.join(case_dir, "repo")
    cmap = os.path.join(case_dir, "claimed-map.json")
    out = os.path.join(outdir, "prod-out")
    r = run(["node", "dist/cli.js", "audit", "--repo", repo, "--map", cmap,
             "--out", out], cwd=SRC)
    rep = os.path.join(out, "repomapverify-report.json")
    p = {"exit": r.returncode}
    if os.path.exists(rep):
        d = json.load(open(rep))
        p.update({"status": d.get("status"),
                  "findings": sorted((f.get("id"), f.get("from"),
                                      f.get("to"))
                                     for f in d.get("findings", [])),
                  "snapshotStatus": d.get("snapshotStatus")})
    else:
        p["error"] = (r.stdout + r.stderr).strip()[-300:]
    oout = os.path.join(outdir, "oracle.json")
    ro = run(["python3", "oracle/python/oracle.py", "--fixture-dir",
              case_dir, "--out", oout], cwd=SRC)
    o = {"exit": ro.returncode}
    if ro.returncode == 0 and os.path.exists(oout):
        d = json.load(open(oout))
        o.update({"status": d["audit"]["status"],
                  "findings": sorted((f.get("id"), f.get("from"),
                                      f.get("to"))
                                     for f in d["audit"]["findings"]),
                  "snapshotStatus": d["audit"]["snapshotStatus"],
                  "gt_edges": sorted((e["from"], e["to"])
                                     for e in d["groundTruth"]["edges"])})
    else:
        o["error"] = (ro.stdout + ro.stderr).strip()[-300:]
    return p, o


def probe_self_edge():
    d = os.path.join(PROBES, "py-self-edge")
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(os.path.join(d, "repo"))
    copy_repo(os.path.join(S0, "python", "py-c01-basic-imports", "repo"),
              os.path.join(d, "repo"))
    with open(os.path.join(d, "repo", "main.py"), "a") as fh:
        fh.write("import main\n")
    m, gt = build_map_from_gt(os.path.join(d, "repo"))
    with open(os.path.join(d, "claimed-map.json"), "w") as fh:
        json.dump(m, fh, indent=2)
    od = os.path.join(EV, "py-self-edge")
    os.makedirs(od, exist_ok=True)
    p, o = audit_both(d, od)
    print(f"self-edge: prod exit={p.get('exit')} {p.get('status')}/"
          f"{p.get('snapshotStatus')} findings={p.get('findings')} | "
          f"oracle exit={o.get('exit')} {o.get('status')}/"
          f"{o.get('snapshotStatus')} findings={o.get('findings')} "
          f"gt_edges={o.get('gt_edges')} prod_gt_edges="
          f"{sorted((e['from'], e['to']) for e in gt['edges'])}")
    print(f"  prod error={p.get('error')} oracle error={o.get('error')}")


def probe_unreadable():
    d = os.path.join(PROBES, "ts-unreadable")
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(os.path.join(d, "repo"))
    copy_repo(os.path.join(S0, "typescript", "ts-ctrl-01", "repo"),
              os.path.join(d, "repo"))
    with open(os.path.join(d, "repo", "src", "secret.ts"), "w") as fh:
        fh.write("export const secret = 1;\n")
    with open(os.path.join(d, "repo", "src", "util.ts"), "a") as fh:
        fh.write('import "./secret";\n')
    os.chmod(os.path.join(d, "repo", "src", "secret.ts"), 0)
    # Can this process read it? (root can; inside unshare -Ur it cannot.)
    try:
        open(os.path.join(d, "repo", "src", "secret.ts")).read()
        readable = True
    except OSError:
        readable = False
    print(f"unreadable: secret.ts readable by this process: {readable}")
    m, gt = build_map_from_gt(os.path.join(d, "repo"))
    with open(os.path.join(d, "claimed-map.json"), "w") as fh:
        json.dump(m, fh, indent=2)
    print(f"  prod GT modules={sorted(x['relativePath'] for x in gt['modules'])} "
          f"edges={sorted((e['from'], e['to']) for e in gt['edges'])}")
    od = os.path.join(EV, "ts-unreadable")
    os.makedirs(od, exist_ok=True)
    p, o = audit_both(d, od)
    print(f"  prod exit={p.get('exit')} {p.get('status')}/"
          f"{p.get('snapshotStatus')} findings={p.get('findings')}")
    print(f"  oracle exit={o.get('exit')} {o.get('status')}/"
          f"{o.get('snapshotStatus')} findings={o.get('findings')}")
    print(f"  prod error={p.get('error')} oracle error={o.get('error')}")


if __name__ == "__main__":
    os.makedirs(EV, exist_ok=True)
    if "--unreadable" in sys.argv:
        probe_unreadable()
    else:
        probe_self_edge()

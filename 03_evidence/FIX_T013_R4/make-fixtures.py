#!/usr/bin/env python3
"""FIX T013 R4: build the ghost-entrypoint regression fixtures.

  py-ghost-entrypoint: py-c01-basic-imports repo, toml declares
    ["main.py", "ghost.py"]; claimed map is the reviewer's R4 probe map
    verbatim (03_evidence/T013_R4/probes/py-r4-ghost-entry/
    claimed-map.json, production snapshot 16ea36e2...).
  py-ghost-ctrl: py-c01-basic-imports repo as shipped (toml ["main.py"]);
    claimed map is the reviewer's R4 ghost-ctrl probe map verbatim
    (map claims ghost.py; production snapshot a80ab95d...).
  go-ghost-entrypoint: go-ctrl-01 repo, toml declares
    ["cmd/server/main.go", "cmd/ghost/main.go"]; claimed map built from
    the production ground truth of that repo (modules + edges + snapshot)
    with entrypoints claimed in their literal toml spellings.
Usage (from 02_source/, after `npm run build`):
  python3 ../03_evidence/FIX_T013_R4/make-fixtures.py
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.expanduser("~/workspace/p024-repomapverify")
SRC = os.path.join(ROOT, "02_source")
S0 = os.path.join(SRC, "tests", "fixtures", "s0")
REG = os.path.join(SRC, "tests", "fixtures", "regression")
R4EV = os.path.join(ROOT, "03_evidence", "T013_R4", "probes")


def copy_repo(src, dst):
    for item in os.listdir(src):
        s, t = os.path.join(src, item), os.path.join(dst, item)
        if os.path.islink(s) or os.path.isfile(s):
            shutil.copy2(s, t, follow_symlinks=False)
        else:
            shutil.copytree(s, t, symlinks=True)


def write_json(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh, indent=2)
        fh.write("\n")


def py_fixture(name, toml_paths, map_src, expected):
    d = os.path.join(REG, name)
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(os.path.join(d, "repo"))
    copy_repo(os.path.join(S0, "python", "py-c01-basic-imports", "repo"),
              os.path.join(d, "repo"))
    with open(os.path.join(d, "repo", ".repomapverify.toml"), "w") as fh:
        fh.write("[entrypoints]\npaths = [%s]\n" % ", ".join(
            '"%s"' % p for p in toml_paths))
    shutil.copy2(map_src, os.path.join(d, "claimed-map.json"))
    write_json(os.path.join(d, "expected.json"), expected)
    print(f"built {name}")


def go_fixture():
    name = "go-ghost-entrypoint"
    d = os.path.join(REG, name)
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(os.path.join(d, "repo"))
    copy_repo(os.path.join(S0, "go", "go-ctrl-01", "repo"),
              os.path.join(d, "repo"))
    with open(os.path.join(d, "repo", ".repomapverify.toml"), "w") as fh:
        fh.write('[entrypoints]\npaths = ["cmd/server/main.go", '
                 '"cmd/ghost/main.go"]\n')
    r = subprocess.run(["node", "dist/cli.js", "ground-truth", "--repo",
                        os.path.join(d, "repo")], cwd=SRC,
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
    g = json.loads(r.stdout)
    mods = sorted(g["modules"], key=lambda m: m["relativePath"])
    m = {"schema": "repomapverify.claimed-map/v1",
         "mapId": "r4fix-go-ghost", "repo": name, "agent": "r4fix",
         "completeness": "FULL_GRAPH",
         "repoSnapshotSha256": g["repoSnapshotSha256"],
         "modules": [{"id": "m%d" % i, "path": x["relativePath"],
                      "kind": "module"} for i, x in enumerate(mods)],
         "entrypoints": ["cmd/server/main.go", "cmd/ghost/main.go"],
         "edges": [{"from": e["from"], "to": e["to"]} for e in g["edges"]]}
    write_json(os.path.join(d, "claimed-map.json"), m)
    write_json(os.path.join(d, "expected.json"), {
        "expectedStatus": "INCOMPLETE",
        "expectedFindings": [],
        "expectedSnapshotStatus": "MATCH",
        "expectedEntrypoints": ["cmd/server"],
        "expectedUnresolvedEntrypoints": ["cmd/ghost/main.go"]})
    print(f"built {name} (prod GT entrypoints {g['entrypoints']}, "
          f"snapshot {g['repoSnapshotSha256'][:8]}...)")


def main():
    py_fixture("py-ghost-entrypoint", ["main.py", "ghost.py"],
               os.path.join(R4EV, "py-r4-ghost-entry", "claimed-map.json"),
               {"expectedStatus": "INCOMPLETE",
                "expectedFindings": [],
                "expectedSnapshotStatus": "MATCH",
                "expectedEntrypoints": ["main.py"],
                "expectedUnresolvedEntrypoints": ["ghost.py"]})
    py_fixture("py-ghost-ctrl", ["main.py"],
               os.path.join(R4EV, "py-r4-ghost-ctrl", "claimed-map.json"),
               {"expectedStatus": "FAIL",
                "expectedFindings": [{"id": "WRONG_ENTRYPOINT",
                                      "from": "ghost.py"}],
                "expectedSnapshotStatus": "MATCH"})
    go_fixture()
    return 0


if __name__ == "__main__":
    sys.exit(main())

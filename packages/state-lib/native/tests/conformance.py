"""Independent from-scratch oracle for the compiled native kernel; not a proof."""
import random
import subprocess
import sys
from pathlib import Path

MAX = (1 << 64) - 1
I64_MIN, I64_MAX = -(1 << 63), (1 << 63) - 1


def commit(cells, revision, expected, writes):
    if expected != revision:
        return "err:StaleRevision", cells, revision
    for i, (slot, _) in enumerate(writes):
        if slot >= len(cells):
            return "err:InvalidSlot", cells, revision
        if i and writes[i - 1][0] >= slot:
            return "err:NonCanonicalWrites", cells, revision
    changed = any(cells[slot] != value for slot, value in writes)
    if changed and revision == MAX:
        return "err:RevisionOverflow", cells, revision
    draft = cells.copy()
    for slot, value in writes:
        draft[slot] = value
    return "ok", draft, revision + int(changed)


def main(binary):
    commands, expected_rows = [], []
    cells, revision = [], 0

    def init(values, epoch=0):
        nonlocal cells, revision
        cells, revision = values.copy(), epoch
        commands.append("init " + " ".join(map(str, [epoch, len(values), *values])))
        expected_rows.append("init " + " ".join(map(str, [revision, *cells])))

    def write(expected, writes):
        nonlocal cells, revision
        command = ["commit", str(expected), str(len(writes))]
        for slot, value in writes:
            command.extend([str(slot), str(value)])
        commands.append(" ".join(command))
        status, cells, revision = commit(cells, revision, expected, writes)
        expected_rows.append(status + " " + " ".join(map(str, [revision, *cells])))

    # Error after an earlier valid write must not partially publish that prefix.
    init([1, 2]); write(0, [(0, 8), (2, 9)]); write(0, [(0, 8), (0, 9)])
    write(0, [(1, 8), (0, 9)]); write(0, []); write(0, [(0, 1), (1, 2)])
    write(0, [(0, I64_MIN), (1, I64_MAX)]); write(0, [(0, 11)])
    init([3], MAX); write(MAX, []); write(MAX, [(0, 3)]); write(MAX, [(0, 4)])
    init([], MAX); write(MAX, []); write(MAX, [(0, 4)])
    init([0], MAX - 1); write(MAX - 1, [(0, 1)]); write(MAX, [(0, 2)])

    for seed in range(64):
        rng = random.Random(seed)
        init([rng.randint(-100, 100) for _ in range(rng.randrange(0, 33))])
        for event in range(250):
            n = len(cells)
            chosen = sorted(rng.sample(range(n), rng.randrange(n + 1)))
            writes = [(slot, rng.choice([cells[slot], I64_MIN, I64_MAX, rng.randint(-100, 100)])) for slot in chosen]
            mode = rng.randrange(8)
            epoch = revision
            if mode == 0: epoch = (revision + 1) % (MAX + 1)
            if mode == 1: writes.append((n, 77))
            if mode == 2 and writes: writes.append(writes[-1])
            if mode == 3: writes.reverse()
            write(epoch, writes)

    result = subprocess.run([str(Path(binary).resolve())], input="\n".join(commands) + "\n", text=True,
                            capture_output=True, timeout=60, check=True)
    actual = result.stdout.splitlines()
    if len(actual) != len(expected_rows):
        raise SystemExit(str((len(actual), len(expected_rows), result.stderr)))
    for i, (got, expected) in enumerate(zip(actual, expected_rows)):
        if got != expected:
            raise SystemExit(f"case {i}: {commands[i]}\nexpected {expected}\ngot {got}")
    print(f"PASS: {len(commands)} native command results, including 16,000 seeded transactions and edge cases")


if __name__ == "__main__":
    main(sys.argv[1])

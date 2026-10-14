//! Unverified conformance driver; the verified executable kernel is in kernel.rs.
//! Whitespace protocol, deliberately dependency-free. Malformed driver input exits.
mod kernel;
use kernel::{CommitError, Kernel, Write};
use std::io::{self, BufRead, Write as IoWrite};

fn parse<T: std::str::FromStr>(it: &mut std::str::SplitWhitespace<'_>) -> Result<T, String> {
    it.next().ok_or("missing argument")?.parse().map_err(|_| "invalid number".into())
}

fn run() -> Result<(), String> {
    let mut kernel = Kernel::from_snapshot(Vec::new(), 0);
    let stdout = io::stdout();
    let mut output = io::BufWriter::new(stdout.lock());
    for line in io::stdin().lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        let mut parts = line.split_whitespace();
        let status = match parts.next() {
            Some("init") => {
                let revision = parse(&mut parts)?;
                let size: usize = parse(&mut parts)?;
                if size > 1_000_000 { return Err("driver input too large".into()); }
                let cells: Result<Vec<i64>, String> = (0..size).map(|_| parse(&mut parts)).collect();
                kernel = Kernel::from_snapshot(cells?, revision);
                "init".to_owned()
            }
            Some("commit") => {
                let expected = parse(&mut parts)?;
                let size: usize = parse(&mut parts)?;
                if size > 1_000_000 { return Err("driver input too large".into()); }
                let mut writes = Vec::with_capacity(size);
                for _ in 0..size { writes.push(Write { slot: parse(&mut parts)?, value: parse(&mut parts)? }); }
                match kernel.commit(expected, &writes) {
                    Ok(_) => "ok".to_owned(),
                    Err(error) => match error {
                        CommitError::StaleRevision => "err:StaleRevision",
                        CommitError::InvalidSlot => "err:InvalidSlot",
                        CommitError::NonCanonicalWrites => "err:NonCanonicalWrites",
                        CommitError::RevisionOverflow => "err:RevisionOverflow",
                    }.to_owned(),
                }
            }
            _ => return Err("expected init or commit".into()),
        };
        if parts.next().is_some() { return Err("trailing input".into()); }
        write!(output, "{} {}", status, kernel.revision()).map_err(|e| e.to_string())?;
        for slot in 0..kernel.len() {
            write!(output, " {}", kernel.read(slot).ok_or("driver read failed")?).map_err(|e| e.to_string())?;
        }
        writeln!(output).map_err(|e| e.to_string())?;
    }
    output.flush().map_err(|e| e.to_string())
}

fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(2); }
}

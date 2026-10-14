//! StateIR's first native boundary: validate a canonical write-set, then publish.
//! The specification and executable algorithm live in this same module.
use vstd::prelude::*;

verus! {

pub enum CommitError { StaleRevision, InvalidSlot, NonCanonicalWrites, RevisionOverflow }

pub struct Write { pub slot: usize, pub value: i64 }

pub struct Kernel { cells: Vec<i64>, revision: u64 }

pub open spec fn canonical_prefix(writes: Seq<Write>, size: nat, count: nat) -> bool {
    count <= writes.len() &&
        (forall|j: int| #![trigger writes[j].slot] 0 <= j < count ==> writes[j].slot < size) &&
        (forall|j: int| #![trigger writes[j].slot, writes[j - 1].slot]
            0 < j < count ==> writes[j - 1].slot < writes[j].slot)
}

pub open spec fn changes_prefix(before: Seq<i64>, writes: Seq<Write>, count: nat) -> bool {
    exists|j: int| #![trigger writes[j]] 0 <= j < count && before[writes[j].slot as int] != writes[j].value
}

pub open spec fn apply_prefix(before: Seq<i64>, writes: Seq<Write>, count: nat) -> Seq<i64>
    decreases count,
{
    if count == 0 { before }
    else { apply_prefix(before, writes, (count - 1) as nat)
        .update(writes[count - 1].slot as int, writes[count - 1].value) }
}

pub open spec fn accepted(before: Seq<i64>, revision: u64, expected: u64, writes: Seq<Write>) -> bool {
    expected == revision && canonical_prefix(writes, before.len(), writes.len()) &&
        (!changes_prefix(before, writes, writes.len()) || revision < u64::MAX)
}

proof fn update_same(before: Seq<i64>, slot: int)
    requires 0 <= slot < before.len(),
    ensures before.update(slot, before[slot]) == before,
{
    assert(before.update(slot, before[slot]) =~= before);
}

impl Kernel {
    pub closed spec fn values(&self) -> Seq<i64> { self.cells@ }
    pub closed spec fn epoch(&self) -> u64 { self.revision }

    pub fn from_snapshot(cells: Vec<i64>, revision: u64) -> (result: Self)
        ensures result.values() == cells@, result.epoch() == revision,
    { Self { cells, revision } }

    pub fn len(&self) -> (result: usize)
        ensures result == self.values().len(),
    { self.cells.len() }

    pub fn revision(&self) -> (result: u64)
        ensures result == self.epoch(),
    { self.revision }

    pub fn read(&self, slot: usize) -> (result: Option<i64>)
        ensures result == if slot < self.values().len() { Some(self.values()[slot as int]) } else { None },
    {
        if slot < self.cells.len() { Some(self.cells[slot]) } else { None }
    }

    /// No caller preconditions: invalid input returns an error without publication.
    /// The caller supplies final writes sorted by slot, with no duplicate slots.
    /// Construction/canonicalisation of that write-set is outside this proof.
    pub fn commit(&mut self, expected: u64, writes: &Vec<Write>) -> (result: Result<u64, CommitError>)
        ensures
            final(self).values().len() == old(self).values().len(),
            result.is_ok() <==> accepted(old(self).values(), old(self).epoch(), expected, writes@),
            match result {
                Ok(revision) => revision == final(self).epoch() &&
                    final(self).values() == apply_prefix(old(self).values(), writes@, writes@.len()) &&
                    final(self).epoch() == old(self).epoch() +
                        if changes_prefix(old(self).values(), writes@, writes@.len()) { 1int } else { 0int },
                Err(_) => final(self).values() == old(self).values() && final(self).epoch() == old(self).epoch(),
            },
    {
        if self.revision != expected { return Err(CommitError::StaleRevision); }
        let ghost before = self.cells@;
        let mut changed = false;
        let mut i: usize = 0;
        // Read-only preflight. Nothing can observe or retain a partial publication.
        while i < writes.len()
            invariant
                i <= writes.len(),
                self.cells@ == before,
                self.revision == old(self).epoch(),
                before == old(self).values(),
                self.revision == expected,
                canonical_prefix(writes@, before.len(), i as nat),
                changed == changes_prefix(before, writes@, i as nat),
                !changed ==> apply_prefix(before, writes@, i as nat) == before,
            decreases writes.len() - i,
        {
            let slot = writes[i].slot;
            let value = writes[i].value;
            if slot >= self.cells.len() { return Err(CommitError::InvalidSlot); }
            if i > 0 && writes[i - 1].slot >= slot { return Err(CommitError::NonCanonicalWrites); }
            if self.cells[slot] != value { changed = true; }
            proof {
                if !changed {
                    update_same(before, slot as int);
                    assert(apply_prefix(before, writes@, (i + 1) as nat) == before);
                }
            }
            i += 1;
        }
        if !changed { return Ok(self.revision); }
        if self.revision == u64::MAX { return Err(CommitError::RevisionOverflow); }
        i = 0;
        // No callback, allocation or fallible user code between validation and publication.
        while i < writes.len()
            invariant
                i <= writes.len(),
                self.revision == old(self).epoch(),
                self.revision == expected,
                self.revision < u64::MAX,
                before == old(self).values(),
                self.cells@.len() == before.len(),
                canonical_prefix(writes@, before.len(), writes@.len()),
                changes_prefix(before, writes@, writes@.len()),
                self.cells@ == apply_prefix(before, writes@, i as nat),
            decreases writes.len() - i,
        {
            let slot = writes[i].slot;
            let value = writes[i].value;
            self.cells[slot] = value;
            i += 1;
        }
        self.revision += 1;
        Ok(self.revision)
    }
}
} // verus!

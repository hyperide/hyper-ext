"""Copy only the five user-supplied original files after verifying every hash."""
import argparse, hashlib, json, shutil
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('source_directory',type=Path);args=parser.parse_args()
here=Path(__file__).resolve().parent
ledger=json.loads((here/'SOURCES.json').read_text())
checked=[]
for record in ledger['sources']:
    source=args.source_directory/record['filename']
    data=source.read_bytes()
    if len(data)!=record['bytes'] or hashlib.sha256(data).hexdigest()!=record['sha256']:
        raise SystemExit('Original-source checksum mismatch: '+str(source))
    destination=here/'originals'/record['filename']
    if destination.exists() and destination.read_bytes()!=data:
        raise SystemExit('Refusing to replace a different original: '+str(destination))
    checked.append((source,destination))
for source,destination in checked:
    destination.parent.mkdir(parents=True,exist_ok=True)
    if not destination.exists():shutil.copyfile(source,destination)
print('Verified and imported',len(checked),'unchanged original source files.')

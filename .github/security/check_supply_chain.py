"""Read-only, dependency-free incident gate. Run with Python -I -S.

This is an incident-specific gate, not a full malware detector. Protect this file,
the workflow, policy, and baseline with reviewed branch rules before enforcement.
"""
import argparse,json,pathlib,re,subprocess,sys

FLOORS={22:(22,23,4),24:(24,22,1),26:(26,12,1)}
WATCH={'package.json','package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb','requirements.txt','pyproject.toml','poetry.lock','uv.lock','Pipfile.lock','Dockerfile','docker-compose.yml','docker-compose.yaml','compose.yml','compose.yaml'}
SKIP={'node_modules','.venv','venv','vendor','.git','dist','build','.next'}

def inspect(root,baseline):
    problems=[];seen=[]
    files=subprocess.run(['git','ls-files','-z'],cwd=root,capture_output=True,check=True).stdout.decode().split('\0')
    for name in filter(None,files):
        path=pathlib.PurePosixPath(name)
        if any(p in SKIP for p in path.parts):continue
        if name.startswith('.github/workflows/') and name.endswith(('.yml','.yaml')):seen.append(name)
        if path.name not in WATCH and not name.startswith('.github/workflows/'):continue
        data=(root/name).read_bytes();text=data.decode('utf-8','replace')
        if path.name in ('package-lock.json','npm-shrinkwrap.json'):
            lock=json.loads(text)
            for location,pkg in lock.get('packages',{}).items():
                package=pkg.get('name') or location.rsplit('node_modules/',1)[-1]
                if (package=='tensorlake' or package.startswith('tensorlake-native-')) and pkg.get('version')=='0.5.144':problems.append(f'{name}: confirmed Tensorlake 0.5.144 lock entry')
        else:
            # Conservative review signal for other lock syntaxes, including binary Bun.
            if re.search(r'tensorlake(?:-native-[\w-]+)?',text,re.I) and '0.5.144' in text:problems.append(f'{name}: Tensorlake 0.5.144 candidate; parse/review required')
        if re.search(r'litellm',text,re.I) and '1.107.0' in text:problems.append(f'{name}: LiteLLM 1.107.0 candidate; parse/review required')
        if '1bbcb1443bc962e45f5aad53fe3d2c30600e0379715fb6c664cdd3ac126c339e' in text:problems.append(f'{name}: malicious LiteLLM image digest')
        if re.search(r'(?im)^\s*(?:FROM\s+|image:\s*)[\w./-]+:latest\b',text):problems.append(f'{name}: mutable latest container tag requires a reviewed digest')
        if name.startswith('.github/workflows/'):
            if re.search(r'(?i)(security[-_]audit|github[-_]actions[-_]security)',path.name):problems.append(f'{name}: watched filename requires review, not proof of malware')
            for version in re.findall(r'''(?m)^\s*node-version:\s*['"]?([\d.x]+)''',text):
                if not re.fullmatch(r'\d+\.\d+\.\d+',version):problems.append(f'{name}: exact Node security version not declared');continue
                parts=tuple(map(int,version.split('.')))
                if parts[0] not in FLOORS or parts<FLOORS[parts[0]]:problems.append(f'{name}: Node {version} below reviewed supported floor')
    expected=set(baseline)
    for name in sorted(set(seen)^expected):problems.append(f'{name}: workflow added/removed without reviewed baseline')
    return problems

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',default='.');parser.add_argument('--baseline',default='.github/security/workflows.json');args=parser.parse_args()
    root=pathlib.Path(args.root).resolve();baseline=json.loads((root/args.baseline).read_text())
    errors=inspect(root,baseline)
    if errors:
        for message in errors:print(message)
        return 1
    print('Reviewed incident indicators, workflow filenames, and declared CI runtime floors passed. This is not host-compromise clearance.')
    return 0

if __name__=='__main__':sys.exit(main())

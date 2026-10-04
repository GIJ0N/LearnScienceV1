# LearnAnything modular

This is a structural split for Git. `app_legacy.py` is the compatibility baseline and remains runnable while modules are migrated. The extracted service files are a first mechanical split; do not delete the legacy entry point until import tests and endpoint parity pass.

## Baseline

```powershell
python app_legacy.py --self-test
python app_legacy.py
```

## Git

```powershell
git init
git add .
git commit -m "chore: baseline modular split"
```

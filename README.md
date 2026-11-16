# LearnAnything modular

This is a structural split for Git. `app_legacy.py` is the compatibility baseline and remains runnable while modules are migrated. The extracted service files are a first mechanical split; do not delete the legacy entry point until import tests and endpoint parity pass.

## Baseline

```powershell
python app_legacy.py --self-test
python app_legacy.py
```

## Modelos por rol (opcional)

Por defecto un solo modelo (`GEMINI_MODEL`) genera, audita y califica. Para separar la auditoría y la calificación, fija las variables antes de iniciar el servidor (ver `docs/judge_model_v1.md`):

```bat
set LEARNSCIENCE_JUDGE_MODEL=nombre-del-modelo
set LEARNSCIENCE_AUDIT_MODEL=nombre-del-modelo
python app_legacy.py
```

En PowerShell: `$env:LEARNSCIENCE_JUDGE_MODEL="nombre-del-modelo"`. `set` solo vale para esa ventana de terminal; sin variables todo usa `GEMINI_MODEL`.

## Alojamiento, inicio de sesión y recordatorios

Opcional; sin configurar nada todo funciona como antes (PC + Tailscale, sin contraseña). Ver `docs/hosting_v1.md` (dónde correr la app, copias de seguridad) y `docs/hosting_ready_v1.md` (contrato: `LEARNSCIENCE_AUTH`, `python app_legacy.py --set-password`, calendario suscribible).

## Git

```powershell
git init
git add .
git commit -m "chore: baseline modular split"
```

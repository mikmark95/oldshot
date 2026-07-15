# OldShot 📷

App web statica (HTML/CSS/JS puro, nessuna dipendenza) che applica un effetto vintage alle foto direttamente nel browser, tramite Canvas API.

**Sito pubblicato:** https://mikmark95.github.io/oldshot/

**Versione attuale:** v1.4.0 — vedi il [changelog](#changelog) qui sotto.

## Funzionalità

- Upload multiplo via drag-and-drop o selezione file (anche più foto insieme), con supporto fotocamera/galleria su mobile
- Ridimensionamento automatico delle immagini grandi (lato massimo 2000px) prima dell'elaborazione
- Anteprima originale/modificata per ogni foto, applicata in serie a tutto il batch
- Effetto vintage regolabile: seppia o bianco e nero, contrasto ridotto, vignettatura, grana
- Download (singolo o di tutte le foto insieme), con salvataggio diretto in Galleria/Foto su iOS e Android tramite Web Share API
- Elaborazione 100% locale: le immagini non vengono mai caricate su un server

## Sviluppo locale

Basta servire la cartella con un qualsiasi server statico, ad esempio:

```
npx serve .
```

oppure

```
python3 -m http.server 8000
```

e aprire `http://localhost:8000`.

## Stack

HTML5, CSS3, JavaScript vanilla (ES6+), Canvas API. Nessun framework, nessuna build.

## Changelog

Versionamento [SemVer](https://semver.org/lang/it/) (`MAJOR.MINOR.PATCH`): il numero avanza a ogni aggiornamento pubblicato — `PATCH` per correzioni, `MINOR` per nuove funzionalità, `MAJOR` per cambi che rompono la compatibilità.

- **v1.4.0** — Aggiunto il selettore di stile Seppia / Bianco e nero
- **v1.3.1** — Corretto il download multiplo su iPad (ora usa il foglio di condivisione nativo come su iPhone)
- **v1.3.0** — Supporto al caricamento e all'elaborazione in serie di più foto contemporaneamente
- **v1.2.1** — Il selettore file ora mostra sia la fotocamera sia la galleria su mobile
- **v1.2.0** — Il download su mobile salva le foto direttamente in Galleria tramite Web Share API
- **v1.1.0** — Nuova landing page con hero, sezione benefit e "come funziona"
- **v1.0.0** — Prima versione pubblicata: upload, effetto vintage regolabile, anteprima e download

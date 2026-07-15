# OldShot 📷

App web statica (HTML/CSS/JS puro, nessuna dipendenza) che applica un effetto vintage alle foto direttamente nel browser, tramite Canvas API.

## Funzionalità

- Upload via drag-and-drop o selezione file, con supporto fotocamera su mobile (`capture="environment"`)
- Ridimensionamento automatico delle immagini grandi (lato massimo 2000px) prima dell'elaborazione
- Anteprima originale/modificata: affiancata su desktop, impilata su mobile
- Effetto vintage regolabile: seppia, contrasto ridotto, vignettatura, grana
- Download del risultato, funzionante su iOS e Android
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

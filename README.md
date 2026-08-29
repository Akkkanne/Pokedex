# Pokédex

Pokédex statique (HTML/CSS/JS, sans build), installable en PWA, données via [PokéAPI](https://pokeapi.co).

## Fonctionnalités
- Recherche par nom ou numéro, filtre par type
- Fiche détaillée : stats en barres, types, talents, taille/poids
- Toggle forme chromatique (shiny)
- Chaîne d'évolution cliquable
- Détection heuristique de l'attaque "signature" (apprise par très peu de Pokémon)
- Cache local (localStorage + Service Worker) : rapide et partiellement utilisable hors-ligne après une première visite
- Installable sur mobile via "Ajouter à l'écran d'accueil"

## Lancer en local
Ouvrir `index.html` directement ne suffit pas pour le Service Worker (il faut un vrai serveur, même local) :

```bash
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Déploiement
Voir les instructions GitHub Pages fournies séparément. En résumé : pousser ce dossier sur un repo GitHub, activer GitHub Pages sur la branche `main`, et l'app sera disponible à `https://<utilisateur>.github.io/<repo>/`.

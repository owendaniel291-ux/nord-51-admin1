# NORD 51 — boutique et administration

## Lancer en local
1. Installe Node.js 18 ou plus récent.
2. Lance `start.bat` sous Windows, ou `npm start` dans ce dossier.
3. Boutique : http://localhost:8080
4. Administration : http://localhost:8080/admin.html

## Stock et codes promo
- Dans Articles, ajoute ou modifie un vêtement et renseigne sa quantité en stock.
- Le stock est vérifié par le serveur au moment de la commande. Les articles épuisés ne s'affichent plus.
- Dans Codes promo, crée une remise en pourcentage ou une livraison offerte. Les codes sont vérifiés côté serveur.
- Le stock est réservé lors de la création de la session Stripe ; il est restauré si Stripe signale que la session a expiré.

## Paiement réel par carte avec Stripe
Le mode Stripe ne peut pas encaisser tant que les clés Stripe ne sont pas configurées. Il faut un compte Stripe actif, un site publié en HTTPS et un adulte responsable pour ouvrir/gérer le compte de paiement si nécessaire.

Configurer les variables d'environnement **sur le serveur** (ne jamais publier les clés dans HTML ni les envoyer à quelqu'un) :
- `STRIPE_SECRET_KEY` : clé secrète Stripe (`sk_test_...` pour tester, `sk_live_...` pour les paiements réels).
- `STRIPE_WEBHOOK_SECRET` : secret du webhook Stripe (`whsec_...`).
- `APP_URL` : URL publique HTTPS de la boutique, sans slash final, par exemple `https://boutique.example`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` : paramètres du serveur d’e-mail. `ADMIN_NOTIFY_EMAIL` (facultatif) reçoit les alertes de nouvelles commandes et de paiements confirmés.

Dans le Dashboard Stripe, créer un webhook vers `https://TON-DOMAINE/api/stripe/webhook` et sélectionner au minimum les événements `checkout.session.completed` et `checkout.session.expired`. Copier son secret dans `STRIPE_WEBHOOK_SECRET`. Ensuite, la boutique utilise Stripe Checkout automatiquement : aucun autre mode de paiement n’est disponible dans le site.

Les commandes Stripe sont créées en attente et passent à « payée » uniquement après confirmation signée par Stripe. Le stock est réservé pendant le paiement puis restauré si la session expire.

## Sécurité importante
Cette version d'administration est sans mot de passe, comme demandé précédemment. Elle ne doit **pas** être mise en ligne publiquement en l'état : toute personne qui y accède pourrait modifier le catalogue, les commandes, les stocks et les codes promo. Avant la publication, ajoute une authentification à l'administration et une base de données adaptée à l'hébergement.

Les clés Stripe sont secrètes : ne les mets jamais dans `index.html`, `admin.html`, une capture d'écran ou un message public.


## Livraison, photos, marques
- Dans Admin > Paiement, coche « Livraison toujours gratuite » pour supprimer les frais de livraison sur la boutique.
- Dans l’éditeur d’article, sélectionne jusqu’à 6 photos. La première est la photo principale.
- La catégorie « Chaussures » est disponible. Le champ marque propose des suggestions mais accepte les marques saisies manuellement.
- Le champ « Authenticité » est une déclaration du vendeur, pas une vérification automatique : conserve les factures/preuves d’achat et ne coche « Authentique — justificatif conservé » que si tu peux le prouver.

## E-mails de connexion et campagnes marketing
1. Copie `.env.example` en `.env` et renseigne les variables SMTP. Ne partage jamais ce fichier. Pour Gmail, crée un mot de passe d’application plutôt que d’utiliser ton mot de passe habituel.
2. Installe les dépendances avec `npm install`, puis relance `start.bat`.
3. Dans Admin > E-mails & pubs, rédige une campagne. Elle ne part qu’aux adresses qui ont consenti à recevoir les offres. Un lien de désinscription est inclus.
4. Lors d’une connexion au compte local du navigateur, un e-mail de sécurité est envoyé si SMTP est configuré. Le code BIENVENUE10 (-10 %) est inclus uniquement si la personne a accepté les e-mails promotionnels. Si SMTP n’est pas configuré, la connexion fonctionne quand même mais aucun e-mail ne part.

**Important :** les comptes clients actuels restent enregistrés dans le navigateur, pas dans une base serveur. La notification e-mail confirme seulement qu’une connexion locale a été demandée ; elle ne remplace pas une vraie authentification serveur. Avant toute mise en ligne, sécurise l’administration et fais revoir la connexion, la protection des données et les obligations légales par un adulte responsable. N’envoie des campagnes qu’aux personnes ayant donné leur accord.


## Paiements

La boutique ne propose que Stripe Checkout. Aucun formulaire de carte maison, mode de paiement fictif interne, PayPal ou virement n’est utilisé. Tant que `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et `APP_URL` ne sont pas configurés, le paiement est bloqué et aucune commande n’est marquée payée. Stripe possède ses propres clés de test et de production : seules les clés live permettent d’encaisser de vrais paiements.


## Connexion avec Google
1. Crée un projet dans Google Cloud Console et configure l'écran de consentement OAuth.
2. Crée un identifiant OAuth de type application Web. Ajoute l'origine du site et l'URL de redirection `https://ton-domaine.fr/auth/google/callback` (en local : `http://localhost:8080/auth/google/callback`).
3. Ajoute `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` au fichier `.env`, puis redémarre le serveur. Ne partage jamais le secret.

Attention : cette version conserve encore les profils et sessions clients dans le navigateur (`localStorage`). Google facilite la connexion sur cet appareil, mais ce n'est pas encore un système de comptes centralisé multi-appareils. Pour une boutique en production, il faut migrer les comptes vers une base de données et des sessions serveur sécurisées.

## Administration avancée
L'administration comprend maintenant les statistiques par période, les filtres/export CSV/impression des commandes, les alertes de stock et de commandes, les fiches clients et un journal des modifications avec restauration quand une ancienne version existe. Le bénéfice est affiché comme estimation du chiffre encaissé tant qu'aucun coût d'achat n'est renseigné.

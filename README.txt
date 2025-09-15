ConstructAfrica Directus CMS (Local Dev)
================================================

This repository contains the **Directus CMS** self-hosted setup for ConstructAfrica.  
It runs inside Docker and is connected to GitHub with SSH for version control.  

------------------------------------------------
📦 Requirements
------------------------------------------------
- macOS (Ventura or newer)
- Docker Desktop: https://www.docker.com/products/docker-desktop/
- Git: https://git-scm.com/
- A GitHub account with access to the repo

------------------------------------------------
🚀 Setup Instructions
------------------------------------------------

1. Clone Repository
-------------------
    git clone git@github-directus:devconstructafrica-ctrl/constructafrica-directus-cms.git
    cd constructafrica-directus-cms

2. Docker Compose Config
------------------------
Create `docker-compose.yml`:

    services:
      directus:
        image: directus/directus:11.5.1
        ports:
          - "8055:8055"
        volumes:
          - ./database:/directus/database
          - ./uploads:/directus/uploads
          - ./extensions:/directus/extensions
        environment:
          SECRET: "replace-with-long-random-string"
          ADMIN_EMAIL: "admin@example.com"
          ADMIN_PASSWORD: "d1r3ctu5"
          DB_CLIENT: "sqlite3"
          DB_FILENAME: "/directus/database/data.db"
          WEBSOCKETS_ENABLED: "true"

Start services:

    docker compose up -d

Access admin UI: http://localhost:8055

3. SSH Key Setup (for GitHub)
-----------------------------
Generate a new SSH key:

    ssh-keygen -t ed25519 -C "dev.constructafrica@gmail.com" -f ~/.ssh/id_ed25519_directus

Start the SSH agent:

    eval "$(ssh-agent -s)"

Add the new key:

    ssh-add ~/.ssh/id_ed25519_directus

Copy the public key:

    cat ~/.ssh/id_ed25519_directus.pub

➡ Add this to GitHub → Settings → SSH and GPG Keys → New SSH key

4. SSH Config
-------------
Edit `~/.ssh/config` and add:

    Host github-directus
      HostName github.com
      User git
      IdentityFile ~/.ssh/id_ed25519_directus
      IdentitiesOnly yes

5. Git Setup
------------
Set remote to use the SSH alias:

    git remote set-url origin git@github-directus:devconstructafrica-ctrl/constructafrica-directus-cms.git

Verify:

    git remote -v

Expected output:

    origin  git@github-directus:devconstructafrica-ctrl/constructafrica-directus-cms.git (fetch)
    origin  git@github-directus:devconstructafrica-ctrl/constructafrica-directus-cms.git (push)

6. Git Commands Reference
-------------------------
Initialize repo (first time only):

    git init
    git branch -M main
    git add .
    git commit -m "Initial Directus setup"
    git push -u origin main

Regular workflow:

    git add .
    git commit -m "Your message"
    git push

7. Useful Commands
------------------
- Start Directus:

      docker compose up -d

- Stop Directus:

      docker compose down

- View logs:

      docker compose logs -f

- Test SSH connection:

      ssh -T github-directus

------------------------------------------------
✅ Notes
------------------------------------------------
- SECRET in docker-compose.yml should be replaced with a long random string:

      openssl rand -base64 32

- Default admin login:
  - Email: admin@example.com
  - Password: d1r3ctu5

- Database: SQLite (database/data.db)
- Uploads: Stored in uploads/
- Extensions: Stored in extensions/

------------------------------------------------

---------------------------------------------------------
Region Database migration commands for region and country
----------------------------------------------------------
Region
-------
(
echo "id,drupal_tid,drupal_uuid,name,status,sort_weight"
terminus drush constructafrica.dev sqlq "
SELECT
  td.tid AS id,              -- use Drupal tid as PK
  td.tid AS drupal_tid,
  td.uuid AS drupal_uuid,
  tfd.name,
  tfd.status,
  tfd.weight
FROM constafrica_taxonomy_term_data td
JOIN constafrica_taxonomy_term_field_data tfd ON td.tid = tfd.tid
LEFT JOIN constafrica_taxonomy_term__parent p ON p.entity_id = td.tid
WHERE tfd.vid = 'country'
  AND (p.parent_target_id IS NULL OR p.parent_target_id = 0)
ORDER BY tfd.weight, tfd.name;
"
) | iconv -f UTF-8 -t UTF-8//IGNORE | tr '\t' ',' > regions.csv

Countries
----------
(
echo "drupal_tid,drupal_uuid,name,description,status,sort_weight,region"
terminus drush constructafrica.dev sqlq "
SELECT
  td.tid AS drupal_tid,
  td.uuid AS drupal_uuid,
  tfd.name,
  REPLACE(IFNULL(tfd.description__value,''), '\r\n', ' ') AS description,
  tfd.status,
  tfd.weight,
  p.parent_target_id AS region       -- use Drupal parent tid as Many-to-One
FROM constafrica_taxonomy_term_data td
JOIN constafrica_taxonomy_term_field_data tfd ON td.tid = tfd.tid
JOIN constafrica_taxonomy_term__parent p ON p.entity_id = td.tid
WHERE tfd.vid = 'country'
  AND p.parent_target_id IS NOT NULL
  AND p.parent_target_id <> 0
ORDER BY tfd.weight, tfd.name;
"
) | iconv -f UTF-8 -t UTF-8//IGNORE | tr '\t' ',' > countries.csv


----------------------------------------------------------------------------------

User
------
(
echo "drupal_uid,username,email,status,created,changed,login,timezone,first_name,last_name,company,phone,country,subscription"
terminus drush constructafrica.dev sqlq "
SELECT u.uid AS drupal_uid,
       u.name AS username,
       u.mail AS email,
       u.status,
       FROM_UNIXTIME(u.created) AS created,
       FROM_UNIXTIME(u.changed) AS changed,
       FROM_UNIXTIME(u.login) AS login,
       u.timezone,
       fn.field_user_first_name_value AS first_name,
       ln.field_user_last_name_value AS last_name,
       co.field_company_value AS company,
       ph.field_phone_value AS phone,
       cn.field_country_value AS country,   -- ISO codes directly here
       sb.field_subscription_value AS subscription
FROM constafrica_users_field_data u
LEFT JOIN constafrica_user__field_user_first_name fn
       ON u.uid = fn.entity_id
LEFT JOIN constafrica_user__field_user_last_name ln
       ON u.uid = ln.entity_id
LEFT JOIN constafrica_user__field_company co
       ON u.uid = co.entity_id
LEFT JOIN constafrica_user__field_phone ph
       ON u.uid = ph.entity_id
LEFT JOIN constafrica_user__field_country cn
       ON u.uid = cn.entity_id
LEFT JOIN constafrica_user__field_subscription sb
       ON u.uid = sb.entity_id
WHERE u.uid IS NOT NULL
  AND u.uid <> 0;
"
) | iconv -f UTF-8 -t UTF-8//IGNORE | tr '\t' ',' > users.csv

Roles
--------------------
terminus drush constructafrica.dev -- php:eval '
$config_storage = \Drupal::service("config.storage");
$names = $config_storage->listAll("user.role.");
echo "role_id,label,is_admin\n";
foreach ($names as $name) {
  $config = \Drupal::config($name);
  echo $config->get("id") . "," . $config->get("label") . "," . ($config->get("is_admin") ?? "") . "\n";
}
' > roles.csv

--------------------------------------------------------------------------------------------------------

Permissions
----------------------
terminus drush constructafrica.dev -- php:eval '
$config_storage = \Drupal::service("config.storage");
$names = $config_storage->listAll("user.role.");
echo "role_id,permission\n";
foreach ($names as $name) {
  $config = \Drupal::config($name);
  $id = $config->get("id");
  foreach ($config->get("permissions") ?? [] as $perm) {
    echo $id . "," . $perm . "\n";
  }
}
' > permissions.csv

---------------------------------------------------------------------------------------------------------

User Roles
------------------
terminus drush constructafrica.dev -- sqlq "
SELECT 'user_id','role_id'
UNION ALL
(
  SELECT u.uid AS user_id,
         CASE
           WHEN u.uid = 0 THEN 'anonymous'
           ELSE 'authenticated'
         END AS role_id
  FROM users_field_data u
  UNION ALL
  SELECT ur.entity_id AS user_id, ur.roles_target_id AS role_id
  FROM user__roles ur
  ORDER BY user_id
);
" > user_roles.csv

----------------------------------------------------------------------------------------------------------




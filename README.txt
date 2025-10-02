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

- Install NGROK:
    brew install ngrok   # macOS
- start docker composer: 
    docker compose up
- add auth:
ngrok config add-authtoken 33682lH5V4HyHt0MtsxBuIsvT9q_7S54aiFa61CfbnkyJ3GC1    
- start NGROK:
    ngrok http 8055
- https://abcd-1234.ngrok.io
       OR
- npm install -g localtunnel
- lt --port 8055 --subdomain mydirectus
- https://mydirectus.loca.lt       

------------------------------------------------
✅ Notes
------------------------------------------------
- start app with : docker compose up -d

- SECRET in docker-compose.yml should be replaced with a long random string:

      openssl rand -base64 32

- Default admin login:
  - Email: admin@example.com
  - Password: d1r3ctu5

- Database: SQLite (database/data.db)
- Uploads: Stored in uploads/
- Extensions: Stored in extensions/

------------------------------------------------

------------
Audit steps
1. find all tables relating to the table in question: terminus drush constructafrica.dev -- sqlq "
SHOW TABLES LIKE '%user%';
"
From the response list:(its more, these are just the useful ones)

constafrica_users_field_data → the real user account info (username, email, password hash, status, created, etc).

constafrica_users → legacy minimal table, mostly uid.

constafrica_users_data → stores serialized metadata about users (preferences, module-specific settings).

constafrica_user__roles → maps users to roles.

constafrica_user__user_picture → profile picture.

2. 
------------

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

Roles 2
--------------------
terminus drush constructafrica.dev -- php:eval '
$config_storage = \Drupal::service("config.storage");
$names = $config_storage->listAll("user.role.");
echo "role_id,label,is_admin\n";
foreach ($names as $name) {
  $config = \Drupal::config($name);
  echo $config->get("id") . "," . $config->get("label") . "," . ($config->get("is_admin") ?? "") . "\n";
}
' | (cat && echo "publisher,Publisher,") > roles.csv


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
(
echo "user_id,role_id"
terminus drush constructafrica.dev -- sqlq "
SELECT ur.entity_id AS user_id,
       ur.roles_target_id AS role_id
FROM constafrica_user__roles ur
WHERE ur.entity_id IS NOT NULL
  AND ur.entity_id <> 0;
"
) | tr '\t' ',' > user_roles.csv


----------------------------------------------------------------------------------------------------------


INDUSTRY_CLASSIFICATION
----------------------------------------------------------------------------------------------
terminus drush catracker.dev -- php:eval '
$config = \Drupal::config("field.storage.node.field_sector");
$allowed = $config->get("settings.allowed_values") ?? [];

echo "drupal_uid,label\n";
foreach ($allowed as $item) {
  echo $item["value"] . "," . $item["label"] . "\n";
}
' > industry_classification.csv

----------------------------------------------------------------------------------------


STATUSES_STAGES
----------------------------------------------------------------------------------------
terminus drush catracker.dev -- php:eval '
echo "drupal_pid,drupal_uuid,type,label,total_sub_stages_count\n";

$paragraphs = \Drupal::entityTypeManager()->getStorage("paragraph")->loadByProperties(["type" => "stages"]);

foreach ($paragraphs as $p) {
    $id = $p->id();
    $uuid = $p->uuid();
    $type = $p->bundle();

    // label field
    $label = $p->get("field_stage_title")->value ?? "";

    // total_sub_stages_count field
    $sub_count = $p->get("field_total_sub_stages_count")->value ?? 0;

    echo "$id,$uuid,$type,$label,$sub_count\n";
}
' > statuses_stages.csv

-------------------------------------------------------------------------------------------


CONTACTS
-------------------------------------------------------------------------------------------------
terminus drush catracker.dev -- php:eval '
use Drupal\Core\Database\Database;

echo "drupal_pid,drupal_uuid,name,email,phone,role,company_drupal_pid,photo,facebook,twitter,linkedin\n";

$connection = Database::getConnection();
$team_refs = $connection->select("paragraph__field_team_member", "ptm")
    ->fields("ptm", ["field_team_member_target_id"])
    ->execute()
    ->fetchCol();

if (!empty($team_refs)) {
    $paragraphs = $connection->select("paragraphs_item", "pi")
        ->fields("pi", ["id", "uuid"])
        ->condition("pi.id", $team_refs, "IN")
        ->execute()
        ->fetchAllAssoc("id");

    foreach ($paragraphs as $pid => $p) {
        $fields_map = [
            "name" => ["table" => "field_name", "column" => "field_name_value"],
            "email" => ["table" => "field_email", "column" => "field_email_value"],
            "phone" => ["table" => "field_phone", "column" => "field_phone_value"],
            "role" => ["table" => "field_role", "column" => "field_role_value"],
            "company_drupal_pid" => ["table" => "field_key_contact_company", "column" => "field_key_contact_company_target_id"],
            "photo" => ["table" => "field_photo", "column" => "field_photo_target_id"],
            "facebook" => ["table" => "field_facebook", "column" => "field_facebook_value"],
            "twitter" => ["table" => "field_twitter", "column" => "field_twitter_value"],
            "linkedin" => ["table" => "field_linkedin", "column" => "field_linkedin_value"]
        ];

        $values = [];
        foreach ($fields_map as $key => $info) {
            $exists = $connection->schema()->tableExists("paragraph__".$info["table"]) &&
                      $connection->schema()->fieldExists("paragraph__".$info["table"], $info["column"]);

            if ($exists) {
                $val = $connection->select("paragraph__".$info["table"], "f")
                    ->fields("f", [$info["column"]])
                    ->condition("f.entity_id", $pid)
                    ->execute()
                    ->fetchField();
                $values[$key] = $val ?? "";
            } else {
                $values[$key] = "";
            }
        }

        echo "{$pid},{$p->uuid}," 
             . implode(",", array_map(fn($v) => "\"".str_replace("\"","\"\"",$v)."\"", $values)) 
             . "\n";
    }
}
' > contacts.csv

------------------------------------------------------------------------------------------------


COMPANIES
-------------------------------------------------------------------------------------------
terminus drush catracker.dev -- php:eval '
use Drupal\node\Entity\Node;

$header = [
  "drupal_nid","drupal_uuid","title","body","activities","address","awards",
  "certifications","comments","company_email","company_role","country_id",
  "region_id","sector_id","type_id","email","employees","fax",
  "headquarter","key_contacts","location_details","location_geo",
  "map_iframe_src","news","news_updates","ongoing_projects","completed_projects",
  "projects","phone","tags","team","website"
];
echo implode(",", $header) . "\n";

$nids = \Drupal::entityQuery("node")
  ->condition("type", "company")
  ->accessCheck(FALSE)
  ->execute();

foreach ($nids as $nid) {
  $node = Node::load($nid);
  $row = [];

  $row[] = $node->id();
  $row[] = $node->uuid();
  $row[] = "\"".str_replace("\"","\"\"", $node->getTitle())."\"";

  // Text fields (strip HTML)
  $row[] = "\"".str_replace("\"","\"\"", strip_tags($node->body->value ?? ""))."\"";
  $row[] = "\"".str_replace("\"","\"\"", strip_tags($node->get("field_activities")->value ?? ""))."\"";
  $row[] = "\"".str_replace("\"","\"\"", strip_tags($node->get("field_address")->value ?? ""))."\"";

  // Multi-value text
  $awards = array_column($node->get("field_awards")->getValue() ?? [], "value");
  $row[] = "\"".str_replace("\"","\"\"", strip_tags(implode(" | ", $awards)))."\"";

  $certifications = array_column($node->get("field_certifications")->getValue() ?? [], "value");
  $row[] = "\"".str_replace("\"","\"\"", strip_tags(implode(" | ", $certifications)))."\"";

  $row[] = "\"".str_replace("\"","\"\"", strip_tags($node->get("field_comments_")->value ?? ""))."\"";
  $row[] = $node->get("field_company_email")->value ?? "";
  $row[] = $node->get("field_company_role")->value ?? "";
  $row[] = $node->get("field_country")->target_id ?? "";
  $row[] = $node->get("field_region")->target_id ?? "";
  $row[] = $node->get("field_sector")->target_id ?? "";
  $row[] = $node->get("field_type")->target_id ?? "";
  $row[] = $node->get("field_email")->value ?? "";
  $row[] = $node->get("field_employees")->value ?? "";
  $row[] = $node->get("field_fax")->value ?? "";

  // Skip gallery + logo for now
  $row[] = "\"".str_replace("\"","\"\"", strip_tags($node->get("field_headquater")->value ?? ""))."\"";

  $contacts = $node->get("field_key_contacts_companies")->getValue();
  $row[] = implode(" | ", array_column($contacts, "target_id"));

  $row[] = "\"".str_replace("\"","\"\"", strip_tags($node->get("field_location_details")->value ?? ""))."\"";

  // Convert geo string into JSON for Directus Map field
  $geo = trim($node->get("field_location_geo")->value ?? "");
  $geoJson = "";
  if (preg_match("/^\s*([0-9\.\-]+)[,\s]+([0-9\.\-]+)\s*$/", $geo, $m)) {
    $geoJson = json_encode([ "lat" => (float)$m[1], "lng" => (float)$m[2] ]);
  }
  $row[] = "\"".str_replace("\"","\"\"", $geoJson)."\"";

  // Extract only src from iframe
  $iframe = $node->get("field_map_iframe")->value ?? "";
  $src = "";
  if (preg_match("/src=\"([^\"]+)\"/", $iframe, $matches)) {
    $src = $matches[1];
  } else {
    $src = $iframe; // fallback
  }
  $row[] = "\"".str_replace("\"","\"\"", $src)."\"";

  $news_refs = $node->get("field_news")->getValue();
  $row[] = implode(" | ", array_column($news_refs,"target_id"));

  $news_updates = $node->get("field_news_updates_paragraph_com")->getValue();
  $row[] = implode(" | ", array_column($news_updates,"target_id"));

  $row[] = implode(" | ", array_column($node->get("field_on_going_projects")->getValue() ?? [],"target_id"));
  $row[] = implode(" | ", array_column($node->get("field_projects_completed")->getValue() ?? [],"target_id"));
  $row[] = implode(" | ", array_column($node->get("field_projects")->getValue() ?? [],"target_id"));

  $row[] = $node->get("field_phone")->value ?? "";

  $tags = $node->get("field_tags_company")->getValue();
  $row[] = implode(" | ", array_column($tags,"target_id"));

  $team = $node->get("field_team")->getValue();
  $row[] = implode(" | ", array_column($team,"target_id"));

  $website = $node->get("field_website")->uri ?? $node->get("field_website")->value ?? "";
  $row[] = "\"".str_replace("\"","\"\"", $website)."\"";

  echo implode(",", $row) . "\n";
}
' > companies.csv

---------------------------------------------------------------------------------------------

PROJECTS
--------------------------------------------------------------------------------------------
terminus drush catracker.dev -- php:eval '
use Drupal\node\Entity\Node;

/**
 * Clean CSV text
 */
function clean_csv_text($text) {
  $text = strip_tags($text);
  return trim($text);
}

// CSV header
$header = [
  "drupal_nid","drupal_uuid","title","body",
  "country","region","sector_uuid","type_uuid","stage_uuid",
  "estimated_value_usd","revised_budget_value_usd","contract_value_usd",
  "email","phone","project_manager_id","developer_id",
  "main_contractor_id","consultant_id","client_owner_id",
  "location","gps_coordinates",
  "construction_start","construction_completion","estimated_completion",
  "financial_close","project_launch","completed","cancelled"
];

// Open output stream
$fp = fopen("php://output", "w");
fputcsv($fp, $header);

// Load nodes
$nids = \Drupal::entityQuery("node")->condition("type", "projects")->accessCheck(FALSE)->execute();
$nodes = Node::loadMultiple($nids);

// Loop nodes
foreach ($nodes as $node) {
  $row = [];
  $row[] = $node->id();
  $row[] = $node->uuid();
  $row[] = clean_csv_text($node->getTitle() ?? "");
  $row[] = clean_csv_text($node->body->value ?? "");

  // --- Use text values instead of TIDs ---
  $row[] = clean_csv_text($node->get("field_country")->value ?? "");
  $row[] = clean_csv_text($node->get("field_region")->value ?? "");

  $row[] = $node->get("field_sector")->target_id ?? "";
  $row[] = $node->get("field_type")->target_id ?? "";
  $row[] = $node->get("field_stages")->target_id ?? "";

  $row[] = $node->get("field_estimated_project_value_us")->value ?? "";
  $row[] = $node->get("field_revised_budget_value_us_m_")->value ?? "";
  $row[] = $node->get("field_contract_value_us_m_")->value ?? "";

  $row[] = clean_csv_text($node->get("field_email")->value ?? "");
  $row[] = clean_csv_text($node->get("field_phone")->value ?? "");

  $row[] = $node->get("field_project_manager")->target_id ?? "";
  $row[] = $node->get("field_developer")->target_id ?? "";
  $row[] = $node->get("field_main_contractor")->target_id ?? "";
  $row[] = $node->get("field_consultant")->target_id ?? "";
  $row[] = $node->get("field_client_owner")->target_id ?? "";

  $row[] = clean_csv_text($node->get("field_location")->value ?? "");
  $row[] = clean_csv_text($node->get("field_gps_coordinates")->value ?? "");

  $row[] = $node->get("field_construction_start")->value ?? "";
  $row[] = $node->get("field_construction_completion")->value ?? "";
  $row[] = $node->get("field_estimated_completion")->value ?? "";
  $row[] = $node->get("field_financial_close")->value ?? "";
  $row[] = $node->get("field_project_launch")->value ?? "";

  $row[] = $node->get("field_completed")->value ?? "";
  $row[] = $node->get("field_cancelled")->value ?? "";

  fputcsv($fp, $row);
}

fclose($fp);
' > projects_export.csv




-------------------------------------------------------------------------------------------

Migration of drupal roles to core directus roles

------------------------------------------------

use this script
---------------
import requests

# Config
DIRECTUS_URL = "http://localhost:8055"  # your Directus instance
ADMIN_EMAIL = "dev.constructafrica@gmail.com"       # your Directus admin email
ADMIN_PASSWORD = "Abayomi@123"  # your Directus admin password

# Step 1: Login to Directus and get an access token
auth_resp = requests.post(
    f"{DIRECTUS_URL}/auth/login",
    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
)

if auth_resp.status_code != 200:
    raise Exception(f"Failed to authenticate: {auth_resp.text}")

access_token = auth_resp.json()["data"]["access_token"]
headers = {"Authorization": f"Bearer {access_token}"}

# Step 2: Fetch roles from your custom collection
roles_resp = requests.get(f"{DIRECTUS_URL}/items/roles", headers=headers)

if roles_resp.status_code != 200:
    raise Exception(f"Failed to fetch custom roles: {roles_resp.text}")

custom_roles = roles_resp.json()["data"]

print(f"Found {len(custom_roles)} custom roles")

# Step 3: Create corresponding Directus system roles
for role in custom_roles:
    label = role["label"]
    is_admin = role.get("is_admin", False)

    payload = {
        "name": label,
        "description": f"Migrated from custom roles collection (id={role['id']})",
        "admin_access": bool(is_admin),   # true/false
        "app_access": True                # allow login into app
    }

    resp = requests.post(f"{DIRECTUS_URL}/roles", headers=headers, json=payload)

    if resp.status_code == 200:
        print(f"✅ Created role: {label}")
    elif resp.status_code == 400 and "already exists" in resp.text.lower():
        print(f"⚠️ Role already exists: {label}")
    else:
        print(f"❌ Failed to create role {label}: {resp.text}")
------------------------------------------------------------------------------------------------------
run these:
- pip3 install requests   
- python3 migrate_roles.py
------------------------------------------------------------------------------------------------------

https://cavally-sightable-jamel.ngrok-free.dev
https://cavally-sightable-jamel.ngrok-free.dev/auth/login
POST:  {
  "email": "web.mudasir@gmail.com",
  "password": "TestPassword123!"
}

https://cavally-sightable-jamel.ngrok-free.dev/users
GET

https://cavally-sightable-jamel.ngrok-free.dev/roles
GET

https://cavally-sightable-jamel.ngrok-free.dev/permissions

https://cavally-sightable-jamel.ngrok-free.dev/items/countries
GET

https://cavally-sightable-jamel.ngrok-free.dev/items/regions
GET

https://cavally-sightable-jamel.ngrok-free.dev/items/regions
GET

https://cavally-sightable-jamel.ngrok-free.dev/items/projects
GET

https://cavally-sightable-jamel.ngrok-free.dev/items/countries
GET

https://cavally-sightable-jamel.ngrok-free.dev/items/contacts
GET

https://cavally-sightable-jamel.ngrok-free.dev/items/industry_classification
GET


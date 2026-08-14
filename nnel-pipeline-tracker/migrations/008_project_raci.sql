-- ==========================================================================
-- 008_project_raci.sql
-- Adds the project RACI matrix table.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS project_raci (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  project_id  INT UNSIGNED  NOT NULL,
  activity    VARCHAR(255)  NOT NULL,
  user_id     INT UNSIGNED  NOT NULL,
  raci_code   ENUM('R','A','C','I') NULL DEFAULT NULL,
  updated_by  INT UNSIGNED  NOT NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_raci (project_id, activity, user_id),
  CONSTRAINT fk_raci_project    FOREIGN KEY (project_id)  REFERENCES projects (id),
  CONSTRAINT fk_raci_user       FOREIGN KEY (user_id)     REFERENCES users (id),
  CONSTRAINT fk_raci_updated_by FOREIGN KEY (updated_by)  REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GRANT SELECT, INSERT, UPDATE, DELETE ON nnel_frp.project_raci TO 'nnel_app'@'localhost';
-- FLUSH PRIVILEGES;

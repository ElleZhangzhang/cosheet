-- 主键全用 UUID：支持分布式生成。

-- 规范的外键约束：ON DELETE CASCADE 保证了数据一致性。

-- 联合唯一索引：比如 (workspace_id, user_id) 防止重复加人。

-- 大文件分块存储（chunks 表）：这是做大表格协作必须的设计，避免了单表过大的性能瓶颈。

-- 软删除：deleted_at 保护数据。

-- 时间精度极高：DATETIME(3) 包含毫秒，适合高频协作场景。

CREATE DATABASE IF NOT EXISTS cosheet
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cosheet;

CREATE TABLE users (
  -- UUID：3个位16进制字符 + 4个-连字符 组成的id
  id            VARCHAR(36)  PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL,

  -- CURRENT_TIMESTAMP(3)-生成时间的函数，精确到毫秒
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- 邮箱唯一索引，防重复注册
  UNIQUE KEY uq_users_email (email)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workspaces (
  id         VARCHAR(36)  PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  owner_id   VARCHAR(36)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- 普通索引，加速查询
  KEY idx_workspaces_owner (owner_id),

  -- 外键关联用户
  CONSTRAINT fk_workspaces_owner
    FOREIGN KEY (owner_id) REFERENCES users(id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workspace_members (
  id           VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL,
  user_id      VARCHAR(36) NOT NULL,
  
  -- 通过role字段区分权限
  role         VARCHAR(20) NOT NULL DEFAULT 'viewer', -- owner|editor|commenter|viewer
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  
  -- 联合唯一：一个人在一个工作区只能有一条记录
  UNIQUE KEY uq_workspace_member (workspace_id, user_id),
  KEY idx_members_user (user_id),

  -- cascade——级联删除：父级（以下两句的体现就是工作区/用户）被删，关联记录也会被自动删除
  -- 1.工作区删了成员记录自动删
  CONSTRAINT fk_members_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,

    -- 2.用户注销成员记录自动删
  CONSTRAINT fk_members_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE files (
  id                    VARCHAR(36)  PRIMARY KEY,
  workspace_id          VARCHAR(36)  NOT NULL,
  name                  VARCHAR(255) NOT NULL,

  -- 最新版本号，用于版本控制
  latest_version_number INT          NOT NULL DEFAULT 0,

  created_by_id         VARCHAR(36)  NOT NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- 自动更新时间
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),

  -- 软删除，保护数据
  deleted_at            DATETIME(3)  NULL,


  KEY idx_files_workspace (workspace_id, deleted_at),

  -- 两个级联删除
  CONSTRAINT fk_files_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,

  CONSTRAINT fk_files_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE file_versions (
  id             VARCHAR(36) PRIMARY KEY,
  file_id        VARCHAR(36) NOT NULL,
  version_number INT         NOT NULL,
  
  -- 列定义
  columns_json   JSON        NOT NULL,

  -- 总行数
  row_count      INT         NOT NULL,

  -- 大表格切成小块存
  chunk_count    INT         NOT NULL,

  -- 文件状态：uploading/ready
  status         VARCHAR(20) NOT NULL DEFAULT 'uploading', -- uploading|ready

  created_by_id  VARCHAR(36) NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- file_id + version_number是唯一的，即同一文件的同一版本只能有一条
  UNIQUE KEY uq_file_version (file_id, version_number),

  KEY idx_versions_file (file_id),

  -- 两条级联删除
  CONSTRAINT fk_versions_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_versions_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE chunks (
  id          VARCHAR(36)  PRIMARY KEY,
  version_id  VARCHAR(36)  NOT NULL,

  -- 第几块
  chunk_index INT          NOT NULL,

  row_count   INT          NOT NULL,

  -- 数据存在哪，应该是路径string
  storage_key VARCHAR(512) NOT NULL,

  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- 版本+块索引 是唯一的
  UNIQUE KEY uq_version_chunk (version_id, chunk_index),

  CONSTRAINT fk_chunks_version
    FOREIGN KEY (version_id) REFERENCES file_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comments (
  id         VARCHAR(36)  PRIMARY KEY,
  file_id    VARCHAR(36)  NOT NULL,
  version_id VARCHAR(36)  NOT NULL,

  -- 评论挂在哪一行
  row_index  INT          NOT NULL,

  -- 评论挂在哪一列
  column_key VARCHAR(255) NULL,

  content    TEXT         NOT NULL,

  -- FIND 评论是否已解决
  resolved   TINYINT(1)   NOT NULL DEFAULT 0,

  author_id  VARCHAR(36)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- 联合索引加速查询某行评论
  KEY idx_comments_row (file_id, version_id, row_index),

  CONSTRAINT fk_comments_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_version
    FOREIGN KEY (version_id) REFERENCES file_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_author
    FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE shares (
  id            VARCHAR(36) PRIMARY KEY,

  -- 随机生成的分享码
  token         VARCHAR(96) NOT NULL,

  file_id       VARCHAR(36) NOT NULL,

  -- 分享权限
  role          VARCHAR(20) NOT NULL DEFAULT 'viewer',

  -- 过期时间，null则为永久有效
  expires_at    DATETIME(3) NULL,

  created_by_id VARCHAR(36) NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- 保证链接不重复
  UNIQUE KEY uq_shares_token (token),
  
  CONSTRAINT fk_shares_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 用于基于表格生成的数据报告
CREATE TABLE reports (
  id            VARCHAR(36)  PRIMARY KEY,
  workspace_id  VARCHAR(36)  NOT NULL,

  -- 关联文件
  file_id       VARCHAR(36)  NULL,
  title         VARCHAR(255) NOT NULL,

  -- 大文本，存Markdown/HTML
  content       LONGTEXT     NOT NULL,

  created_by_id VARCHAR(36)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                  ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_reports_workspace (workspace_id),
  CONSTRAINT fk_reports_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_creator
    FOREIGN KEY (created_by_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "github.com/lib/pq"
)

var (
	DB  *sql.DB
	dsn string
)

// Connect initialise la connexion PostgreSQL avec pool et timeouts
func Connect(databaseURL string) error {
	if databaseURL == "" {
		return fmt.Errorf("missing DATABASE_URL")
	}

	var err error
	DB, err = sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("open connection: %w", err)
	}

	// Configuration du pool — ajustable via env
	setPoolLimits()

	// Timeout de connexion initial
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := DB.PingContext(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	log.Printf("✅ Connected to PostgreSQL (max %d conns, idle %d)", getEnvInt("DB_MAX_OPEN", 20), getEnvInt("DB_MAX_IDLE", 10))
	return nil
}

// setPoolLimits configure le pool de connexions
func setPoolLimits() {
	maxOpen := getEnvInt("DB_MAX_OPEN", 20)
	maxIdle := getEnvInt("DB_MAX_IDLE", 10)
	maxLifetime := getEnvDuration("DB_CONN_LIFETIME", 30*time.Minute)

	DB.SetMaxOpenConns(maxOpen)
	DB.SetMaxIdleConns(maxIdle)
	DB.SetConnMaxLifetime(maxLifetime)
}

// Close ferme proprement la connexion
func Close() {
	if DB != nil {
		log.Println("🧹 Closing database connections...")
		DB.Close()
	}
}

// WithTx exécute une fonction dans une transaction avec rollback automatique sur erreur
func WithTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Utility: récupère un entier depuis les variables d’environnement
func getEnvInt(key string, def int) int {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	var n int
	_, err := fmt.Sscanf(val, "%d", &n)
	if err != nil {
		return def
	}
	return n
}

// Utility: récupère une durée depuis l’environnement
func getEnvDuration(key string, def time.Duration) time.Duration {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	d, err := time.ParseDuration(val)
	if err != nil {
		return def
	}
	return d
}

func InitDBFromSQLFile(path string) error {
	sqlBytes, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	_, err = DB.Exec(string(sqlBytes))
	return err
}

func ApplyMigrationFileIfNeeded(ctx context.Context, path string) error {
	if DB == nil {
		return fmt.Errorf("database not connected")
	}

	name := filepath.ToSlash(path)

	_, err := DB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	var exists bool
	if err := DB.QueryRowContext(
		ctx,
		`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name = $1)`,
		name,
	).Scan(&exists); err != nil {
		return fmt.Errorf("check migration %s: %w", name, err)
	}
	if exists {
		return nil
	}

	sqlBytes, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", path, err)
	}

	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, string(sqlBytes)); err != nil {
		return fmt.Errorf("apply migration %s: %w", name, err)
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO schema_migrations(name) VALUES ($1)`,
		name,
	); err != nil {
		return fmt.Errorf("record migration %s: %w", name, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %s: %w", name, err)
	}

	log.Printf("✅ Migration applied: %s", name)
	return nil
}

func InitializeStructure() error {
	// Ici, vous pouvez ajouter le code pour initialiser la structure de la base de données
	// par exemple, créer des tables si elles n'existent pas déjà.

	return nil
}

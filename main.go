package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// gracefulTimeout définit combien de temps on laisse aux requêtes en cours avant d'arrêter le serveur
const gracefulTimeout = 10 * time.Second

func main() {

	// --- Chargement de la config .env ---
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Aucun fichier .env trouvé (OK si Docker gère les variables)")
	}

	// --- Connexion DB ---
	if err := Connect(os.Getenv("DATABASE_URL")); err != nil {
		log.Fatal("❌ DB connection error:", err)
	}
	defer Close()

	if err := InitDBFromSQLFile("init.sql"); err != nil {
		log.Fatal("DB init error:", err)
	}

	// --- Mode Release ---
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	// --- Middlewares critiques ---
	r.Use(gin.Recovery()) // évite crash panics

	// 🟢 CORS doit venir ici, tout en haut :
	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{
			"http://localhost:5173",
			"http://localhost:3000",
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "Accept"},
		ExposeHeaders:    []string{"Content-Length", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// ensuite seulement :
	r.Use(RateLimitMiddleware())
	r.Use(TimeoutMiddleware(8 * time.Second))
	r.MaxMultipartMemory = 100 << 20

	// --- Logs customisés pour prod ---
	r.Use(func(c *gin.Context) {
		start := time.Now()
		c.Next()
		duration := time.Since(start)
		status := c.Writer.Status()
		log.Printf("[%s] %s %d (%v)\n", c.Request.Method, c.Request.URL.Path, status, duration)
	})

	// --- Proxies de confiance ---
	trustedProxies := []string{"127.0.0.1", "::1", "172.18.0.0/16", "172.24.0.0/16"}
	if err := r.SetTrustedProxies(trustedProxies); err != nil {
		log.Fatalf("Erreur configuration proxy: %v", err)
	}

	// --- Démarre le nettoyage périodique du cache galerie ---

	r.POST("/login", LoginHandler)
	r.POST("/login/init", LoginInitHandler)
	r.POST("/login/verify", VerifyA2FHandler)

	// --- Lancement serveur avec arrêt propre ---
	srv := &http.Server{
		Addr:         ":8082",
		Handler:      r,
		ReadTimeout:  8 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Gestion des signaux OS pour arrêt propre
	idleConnsClosed := make(chan struct{})
	go func() {
		sigint := make(chan os.Signal, 1)
		signal.Notify(sigint, os.Interrupt, syscall.SIGTERM)
		<-sigint

		log.Println("🛑 Arrêt du serveur en cours...")
		ctx, cancel := context.WithTimeout(context.Background(), gracefulTimeout)
		defer cancel()

		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("Erreur arrêt serveur: %v", err)
		}
		close(idleConnsClosed)
	}()

	log.Println("✅ Server running on :8082")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("❌ Server crash: %v", err)
	}

	<-idleConnsClosed
	log.Println("👋 Serveur arrêté proprement.")
}

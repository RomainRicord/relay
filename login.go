package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pquerna/otp/totp"
)

type User struct {
	ID         string
	A2FSecret  []byte
	A2FEnabled bool
}

func GetUserByEmail(ctx context.Context, email string) (*User, error) {
	u := &User{}
	err := DB.QueryRowContext(ctx, `
		SELECT id, a2f_secret, a2f_enabled
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.A2FSecret, &u.A2FEnabled)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func EnsureUser(ctx context.Context, email string) (userID string, err error) {
	err = DB.QueryRowContext(ctx, `
		INSERT INTO users (email)
		VALUES ($1)
		ON CONFLICT (email)
		DO UPDATE SET email = EXCLUDED.email
		RETURNING id
	`, email).Scan(&userID)

	return
}

func VerifyA2FHandler(c *gin.Context) {
	var req struct {
		UserID string `json:"user_id"`
		Code   string `json:"code"`
	}
	if err := c.BindJSON(&req); err != nil || req.Code == "" {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	var secret []byte
	var enabled bool

	err := DB.QueryRow(`
		SELECT a2f_secret, a2f_enabled
		FROM users WHERE id = $1
	`, req.UserID).Scan(&secret, &enabled)

	if err != nil {
		c.JSON(403, gin.H{"error": "user not found"})
		return
	}

	if !totp.Validate(req.Code, string(secret)) {
		c.JSON(401, gin.H{"error": "invalid code"})
		return
	}

	// Activer A2F si première fois
	if !enabled {
		DB.Exec(`UPDATE users SET a2f_enabled = true WHERE id = $1`, req.UserID)
	}

	// JWT signé (compatible AuthMiddleware)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": req.UserID,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sign token"})
		return
	}

	c.JSON(200, gin.H{
		"token":   tokenString,
		"user_id": req.UserID,
	})
}

func LoginInitHandler(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.BindJSON(&req); err != nil || req.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email"})
		return
	}

	ctx := c.Request.Context()
	user, err := GetUserByEmail(ctx, req.Email)
	if err != nil {

		fmt.Printf("DB error: %v\n", err)

		c.JSON(500, gin.H{"error": "db error"})
		return
	}

	// 🆕 Nouvel utilisateur → enrollement A2F
	if user == nil {
		key, err := totp.Generate(totp.GenerateOpts{
			Issuer:      "Eureka",
			AccountName: req.Email,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "totp error"})
			return
		}

		var userID string
		err = DB.QueryRowContext(ctx, `
			INSERT INTO users (email, a2f_secret, a2f_enabled)
			VALUES ($1, $2, false)
			RETURNING id
		`, req.Email, key.Secret()).Scan(&userID)

		if err != nil {
			fmt.Printf("DB error: %v\n", err)
			c.JSON(500, gin.H{"error": "db error"})
			return
		}

		c.JSON(200, gin.H{
			"status":  "ENROLL",
			"user_id": userID,
			"qr":      key.URL(), // à afficher en QR code côté front
		})
		return
	}

	// 👤 User existant → demander le code
	if user.A2FEnabled {
		c.JSON(200, gin.H{
			"status":  "A2F_REQUIRED",
			"user_id": user.ID,
		})
		return
	}

	c.JSON(403, gin.H{"error": "account not activated"})
}

// Login handler with QR Code A2F support
func LoginHandler(c *gin.Context) {
	var loginData struct {
		Email string `json:"email"`
	}
	if err := c.BindJSON(&loginData); err != nil || loginData.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	userID, err := EnsureUser(ctx, loginData.Email)
	if err != nil {
		fmt.Printf("DB error: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	// Génération du JWT
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sign token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":   tokenString,
		"user_id": userID,
	})
}

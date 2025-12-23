package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type CreateClientRequest struct {
	EncryptedPayload []byte `json:"encrypted_payload"`
	Nonce            []byte `json:"nonce"`
	Keys             []struct {
		UserID       string `json:"user_id"`
		EncryptedKey []byte `json:"encrypted_key"`
		Nonce        []byte `json:"nonce"`
	} `json:"keys"`
}

func CreateClientHandler(c *gin.Context) {
	var req CreateClientRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	tx, err := DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	var clientID string
	err = tx.QueryRowContext(c.Request.Context(), `
		INSERT INTO clients (encrypted_payload, nonce)
		VALUES ($1, $2)
		RETURNING id
	`, req.EncryptedPayload, req.Nonce).Scan(&clientID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to insert client"})
		return
	}

	for _, k := range req.Keys {
		_, err := tx.ExecContext(c.Request.Context(), `
			INSERT INTO client_keys (client_id, user_id, encrypted_key, nonce)
			VALUES ($1, $2, $3, $4)
		`, clientID, k.UserID, k.EncryptedKey, k.Nonce)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to insert key"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": clientID})
}

func GetClientsHandler(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := DB.QueryContext(c.Request.Context(), `
		SELECT c.id, c.encrypted_payload, c.nonce, ck.encrypted_key, ck.nonce
		FROM clients c
		JOIN client_keys ck ON c.id = ck.client_id
		WHERE ck.user_id = $1
	`, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	var clients []gin.H
	for rows.Next() {
		var id string
		var payload, pNonce, key, kNonce []byte
		if err := rows.Scan(&id, &payload, &pNonce, &key, &kNonce); err != nil {
			continue
		}
		clients = append(clients, gin.H{
			"id":                id,
			"encrypted_payload": payload,
			"payload_nonce":     pNonce,
			"encrypted_key":     key,
			"key_nonce":         kNonce,
		})
	}

	c.JSON(http.StatusOK, clients)
}

func GetAllUsersHandler(c *gin.Context) {
	rows, err := DB.QueryContext(c.Request.Context(), `
		SELECT id, email, ecdh_pubkey FROM users WHERE ecdh_pubkey IS NOT NULL
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	var users []gin.H
	for rows.Next() {
		var id, email string
		var pubKey []byte
		if err := rows.Scan(&id, &email, &pubKey); err != nil {
			continue
		}
		users = append(users, gin.H{
			"id":          id,
			"email":       email,
			"ecdh_pubkey": pubKey,
		})
	}

	c.JSON(http.StatusOK, users)
}

package main

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

type CreateClientRequest struct {
	EncryptedPayload []byte            `json:"encrypted_payload"`
	Nonce            []byte            `json:"nonce"`
	WrappedKeys      map[string][]byte `json:"wrapped_keys"` // userID -> encrypted DEK
	KeyNonces        map[string][]byte `json:"key_nonces"`
}

func CreateClient(c *gin.Context) {
	//userID := c.GetString("user_id")

	var req CreateClientRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	err := WithTx(c.Request.Context(), func(tx *sql.Tx) error {
		var clientID string
		if err := tx.QueryRow(`
			INSERT INTO clients (encrypted_payload, nonce)
			VALUES ($1, $2)
			RETURNING id
		`, req.EncryptedPayload, req.Nonce).Scan(&clientID); err != nil {
			return err
		}

		for uid, encKey := range req.WrappedKeys {
			if _, err := tx.Exec(`
				INSERT INTO client_keys (client_id, user_id, encrypted_key, nonce)
				VALUES ($1, $2, $3, $4)
			`, clientID, uid, encKey, req.KeyNonces[uid]); err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	c.Status(http.StatusCreated)
}

func GetClient(c *gin.Context) {
	userID := c.GetString("user_id")
	clientID := c.Param("client_id")

	var payload, nonce, encKey, keyNonce []byte

	err := DB.QueryRowContext(c.Request.Context(), `
		SELECT c.encrypted_payload, c.nonce,
		       ck.encrypted_key, ck.nonce
		FROM clients c
		JOIN client_keys ck ON ck.client_id = c.id
		WHERE c.id = $1 AND ck.user_id = $2
	`, clientID, userID).Scan(&payload, &nonce, &encKey, &keyNonce)

	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"encrypted_payload": payload,
		"nonce":             nonce,
		"encrypted_key":     encKey,
		"key_nonce":         keyNonce,
	})
}

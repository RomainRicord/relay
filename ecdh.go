package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type RegisterKeyRequest struct {
	PubKey []byte `json:"ecdh_pubkey"`
}

func RegisterE2EEKey(c *gin.Context) {
	userID := c.GetString("user_id") // depuis middleware JWT

	var req RegisterKeyRequest
	if err := c.BindJSON(&req); err != nil || len(req.PubKey) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid key"})
		return
	}

	_, err := DB.ExecContext(c.Request.Context(), `
		UPDATE users
		SET ecdh_pubkey = $1
		WHERE id = $2
	`, req.PubKey, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	c.Status(http.StatusNoContent)
}

func GetUserE2EEKey(c *gin.Context) {
	targetID := c.Param("user_id")

	var pub []byte
	err := DB.QueryRowContext(c.Request.Context(), `
		SELECT ecdh_pubkey FROM users WHERE id = $1
	`, targetID).Scan(&pub)

	if err != nil || len(pub) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	}

	c.Data(http.StatusOK, "application/octet-stream", pub)
}

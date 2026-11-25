FROM codercom/code-server:latest

USER coder
RUN curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path
ENV PATH="/home/coder/.opencode/bin:${PATH}"
RUN code-server --install-extension sst-dev.opencode || true

USER root
COPY ide/entrypoint.sh /usr/local/bin/forge-ide-entrypoint
RUN chmod 755 /usr/local/bin/forge-ide-entrypoint
USER root

ENTRYPOINT ["/usr/local/bin/forge-ide-entrypoint"]
CMD ["--bind-addr", "0.0.0.0:8080", "--auth", "none", "--disable-telemetry", "--disable-getting-started-override", "--disable-workspace-trust", "/workspace"]
